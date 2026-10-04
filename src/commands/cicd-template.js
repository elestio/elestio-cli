import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, outputJson, formatTable } from '../utils.js';
import { getTemplates } from './templates.js';
import { createSubstitutions, normalizeElestioConfig, repoFileMounts } from '../templates/elestio-config.js';
import { buildGitPipelinePayload, buildComposePipelinePayload, buildTemplateRepoPipelinePayload } from '../payloads/pipeline.js';
import { parseGitAuthId } from './cicd.js';
import { TEMPLATE_REPO_OWNER, TEMPLATE_REPO_HOST } from '../constants.js';

/**
 * `elestio cicd deploy-template` - deploy catalog software as a CI/CD pipeline.
 *
 * Every catalog entry has a matching repo under github.com/elestio-examples
 * carrying an elestio.yml that describes how to run it: ports, environment
 * variables, lifecycle hooks. Creating a pipeline without reading that file
 * produces a pipeline that starts nothing, which is why this is a dedicated
 * command rather than a flag on `cicd create`.
 *
 * Three routes:
 *   repo (default) - point the pipeline at the elestio-examples repo itself.
 *             Elestio clones it on the VM with its own Git token, so the repo's
 *             files exist and its install scripts run. No Git account needed,
 *             nothing copied into the user's account. This is what the
 *             dashboard does.
 *   inline  - inline the docker-compose.yml only (--inline-compose). No
 *             checkout: install scripts are skipped and any file the compose
 *             mounts or reads (env_file) is missing. Half the catalogue cannot
 *             work this way.
 *   git     - generate the template repo into the user's own Git account
 *             (--owner). Needs an endpoint the API does not expose (404).
 */

function templateRepoUrl(repoName) {
  return `${TEMPLATE_REPO_HOST}/${TEMPLATE_REPO_OWNER}/${repoName}`;
}

/**
 * Repos under elestio-examples are named after the catalog title, lowercased
 * and hyphenated -- "N8N" -> n8n, "InvenTree" -> inventree. GitHub resolves
 * repository names case-insensitively, so the casing does not have to match.
 *
 * Do not derive this from dockerhub_image: that is the upstream image
 * ("n8nio/n8n"), not the template repo.
 */
export function templateRepoName(template) {
  return String(template.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchGitContent(url, branch, file, projectId, authID = null) {
  const response = await apiRequest('/api/cicd/getGitContent', 'POST', {
    url, branch, file,
    unAuthorized: !authID,
    authID: authID || '',
    projectID: String(projectId),
    pipelineID: null,
    contentPath: ''
  });

  if (response && response.status === 'KO') return null;
  return response;
}

/**
 * Reads elestio.yml from a template repo. The backend parses the YAML, so the
 * CLI stays dependency-free.
 */
export async function fetchElestioConfig(repoUrl, branch, projectId, email, authID = null) {
  const raw = await fetchGitContent(repoUrl, branch, 'elestio', projectId, authID);
  const subs = createSubstitutions(email);
  return { config: normalizeElestioConfig(raw, subs), subs, raw };
}

export async function fetchCompose(repoUrl, branch, projectId, authID = null) {
  const response = await fetchGitContent(repoUrl, branch, 'docker-compose', projectId, authID);
  const compose = response?.data?.dockerCompose;
  if (!compose) {
    throw new Error(`No docker-compose file found in ${repoUrl} on branch "${branch}"`);
  }
  return compose;
}

async function resolveCicdTarget(vmID, projectId) {
  const response = await apiRequest('/api/cicd/getCICDServices', 'POST', { projectID: String(projectId) });
  const services = Array.isArray(response) ? response : (response.data?.services || []);
  const target = services.find(s => String(s.providerServerID) === String(vmID) || String(s.vmID) === String(vmID));

  if (!target) {
    const available = services.map(s => s.providerServerID || s.vmID).join(', ') || 'none';
    throw new Error(
      `CI/CD target ${vmID} not found in project ${projectId}. Available targets: ${available}. ` +
      'Create one with: elestio deploy CI-CD-Target'
    );
  }

  return {
    displayName: target.displayName || target.name,
    id: target.id || target.serverID,
    serverName: target.serverName || '',
    vmID: String(target.providerServerID || target.vmID),
    vmProvider: target.vmProvider || target.provider || '',
    vmRegion: target.vmRegion || target.datacenter || '',
    levelName: target.levelName || 'Elestio-services',
    projectID: String(projectId)
  };
}

async function findGitAuth(gitType) {
  const response = await apiRequest('/api/cicd/getCICDUserAuthAccount', 'POST', {});
  return parseGitAuthId(response, gitType);
}

/**
 * Generates the template repo into the user's Git account.
 * GitHub uses the template-generate API; GitLab imports the repo by URL.
 *
 * NOTE: /api/cicd/createRepoByTemplate currently returns 404 in production -
 * the controller exists in the backend but is not registered in apiconfig.json,
 * which is the route whitelist. Until that is fixed the Git route cannot work,
 * so --no-git is the default and this path reports the gap precisely rather
 * than surfacing a bare 404.
 */
async function generateRepoFromTemplate({ gitType, authID, owner, repoName, templateName, isPrivate, isNonOrg }) {
  let response;

  try {
    response = await apiRequest('/api/cicd/createRepoByTemplate', 'POST', {
      ownerName: owner,
      repoName,
      templateName,
      gitType,
      authID: String(authID),
      isPrivate: String(!!isPrivate),
      isNonOrg: !!isNonOrg
    });
  } catch (err) {
    if (/non-JSON response \(HTTP 404\)|HTTP 404/.test(err.message)) {
      throw new Error(
        'The Elestio API does not currently expose /api/cicd/createRepoByTemplate (404), ' +
        'so the Git route is unavailable. Deploy with --no-git instead; the software will run, ' +
        'but any lifecycle scripts it declares will be skipped.'
      );
    }
    throw err;
  }

  if (response?.status === 'KO') {
    throw new Error(response.message || response.details?.message || `Could not create "${repoName}" in ${owner}`);
  }
  return response;
}

export async function listDeployableTemplates(query, json = false) {
  const templates = await getTemplates();
  const q = (query || '').toLowerCase();
  const matches = templates
    .filter(t => !q || t.title?.toLowerCase().includes(q) || String(t.id) === q)
    .map(t => ({ id: t.id, title: t.title, category: t.category, repo: templateRepoName(t) }));

  if (json) { outputJson(matches); return matches; }

  console.log(`\n${colors.bold}Catalog software deployable as a pipeline (${matches.length})${colors.reset}\n`);
  console.log(formatTable(matches.slice(0, 60), [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Software' },
    { key: 'category', label: 'Category' },
    { key: 'repo', label: 'Template repo' }
  ]));
  if (matches.length > 60) console.log(`\n  ... and ${matches.length - 60} more. Narrow with: elestio cicd templates <query>`);
  console.log('');
  return matches;
}

/**
 * @param {string} nameOrId  catalog template, by name or ID
 * @param {object} options   see cli.js for the flag mapping
 */
export async function deployTemplate(nameOrId, options = {}) {
  const config = loadConfig();
  const projectId = options.project || config.defaultProject;
  if (!projectId) throw new Error('Project ID required. Use --project or set a default.');
  if (!options.target) throw new Error('A CI/CD target is required (--target <vmID>). List them with: elestio cicd targets');

  const templates = await getTemplates();
  const template = templates.find(t =>
    String(t.id) === String(nameOrId) || t.title?.toLowerCase() === String(nameOrId).toLowerCase()
  ) || templates.find(t => t.title?.toLowerCase().includes(String(nameOrId).toLowerCase()));

  if (!template) {
    throw new Error(`Template "${nameOrId}" not found. Search with: elestio cicd templates ${nameOrId}`);
  }

  const repoName = options.repoName || templateRepoName(template);
  const pipelineName = options.name || repoName;
  const branch = options.branch || 'main';
  const sourceRepoUrl = templateRepoUrl(repoName);
  // Opt-in, not opt-out: the Git route depends on an endpoint the API does not
  // currently expose (see generateRepoFromTemplate).
  const useGit = options.git === true;

  log('info', `Resolving CI/CD target ${options.target}...`);
  const target = await resolveCicdTarget(options.target, projectId);
  log('success', `Target: ${target.displayName} (${target.vmID})`);

  log('info', `Reading elestio.yml from ${TEMPLATE_REPO_OWNER}/${repoName}...`);
  const { config: elestioConfig, subs } = await fetchElestioConfig(sourceRepoUrl, branch, projectId, config.email);

  if (!elestioConfig.hasConfig) {
    throw new Error(
      `No elestio.yml found at ${sourceRepoUrl} (branch "${branch}"). ` +
      `"${template.title}" may not be publishable as a pipeline; deploy it as a managed service instead: elestio deploy ${template.id}`
    );
  }
  log('success', `Config loaded: runtime "${elestioConfig.config.runTime}", ${elestioConfig.variables ? elestioConfig.variables.split('\n').length : 0} env vars, ${elestioConfig.ports.length} port(s)`);

  const route = useGit ? 'git' : (options.inlineCompose ? 'inline' : 'repo');
  const payload = route === 'git'
    ? await buildGitRoute({ options, projectId, target, template, repoName, pipelineName, branch, elestioConfig, dryRun: !!options.dryRun })
    : route === 'inline'
      ? await buildComposeRoute({ projectId, target, repoName, pipelineName, branch, sourceRepoUrl, elestioConfig, force: options.force })
      : await buildTemplateRepoRoute({ projectId, target, repoName, pipelineName, branch, sourceRepoUrl, elestioConfig });

  if (options.dryRun) {
    if (options.json) { outputJson({ dryRun: true, route, payload }); return payload; }
    printPlan({ template, repoName, pipelineName, target, elestioConfig, route, branch });
    log('info', 'To deploy, run the same command without --dry-run');
    return payload;
  }

  log('info', 'Creating pipeline...');
  const response = await apiRequest('/api/cicd/createCiCdExistServer', 'POST', payload);

  if (response.status !== 'OK' && !response.providerServerID && !response.pipelineID) {
    throw new Error(response.message || JSON.stringify(response));
  }

  log('success', `Pipeline "${pipelineName}" created on ${target.displayName}`);

  if (options.json) {
    outputJson({ status: 'OK', pipelineName, target: target.vmID, route, webUI: elestioConfig.webUI, response });
    return response;
  }

  printAccess(elestioConfig, subs, target);
  return response;
}

async function buildGitRoute({ options, projectId, target, template, repoName, pipelineName, branch, elestioConfig, dryRun = false }) {
  const gitType = (options.gitType || 'GITHUB').toUpperCase();

  let authID = options.authId ? String(options.authId) : await findGitAuth(gitType);
  if (!authID) {
    throw new Error(
      `No ${gitType} account connected. Connect one in the dashboard (CI/CD > Git accounts), pass --auth-id, ` +
      'or deploy without Git using --no-git (lifecycle scripts will be skipped).'
    );
  }

  const owner = options.owner;
  if (!owner) {
    throw new Error('The Git account or organisation to create the repo in is required (--owner <user-or-org>)');
  }

  // A dry run must create nothing, and this step creates a repository in the
  // user's Git account.
  let repo = null;
  if (dryRun) {
    log('info', `Would create ${owner}/${repoName} from ${TEMPLATE_REPO_OWNER}/${repoName}`);
  } else {
    log('info', `Creating ${owner}/${repoName} from ${TEMPLATE_REPO_OWNER}/${repoName}...`);
    repo = await generateRepoFromTemplate({
      gitType, authID, owner, repoName,
      templateName: repoName,
      isPrivate: !!options.private,
      isNonOrg: !!options.nonOrg
    });
    log('success', `Repo created: ${owner}/${repoName}`);
  }

  return buildGitPipelinePayload({
    target,
    projectId,
    pipelineName,
    gitType,
    repo: `${owner}/${repoName}`,
    branch,
    repoID: repo?.id ?? repo?.content?.id ?? '',
    elestioConfig,
    authID,
    isPublicGitRepo: !options.private,
    isNeedToCreateRepo: true,
    appType: 'docker',
    overrides: collectOverrides(options)
  });
}

/**
 * Default route: the pipeline points at the template repo, which Elestio clones
 * on the VM. Nothing to refuse -- the repo's files are there and its install
 * scripts run.
 */
async function buildTemplateRepoRoute({ projectId, target, repoName, pipelineName, branch, sourceRepoUrl, elestioConfig }) {
  log('info', `Fetching docker-compose from ${TEMPLATE_REPO_OWNER}/${repoName}...`);
  const compose = await fetchCompose(sourceRepoUrl, branch, projectId);
  log('success', 'Compose file loaded');

  const hooks = installHooks(elestioConfig);
  if (hooks.length > 0) log('info', `Install scripts run from the cloned repo: ${hooks.join(', ')}`);

  return buildTemplateRepoPipelinePayload({ target, projectId, pipelineName, compose, repoName, branch, elestioConfig });
}

async function buildComposeRoute({ projectId, target, repoName, pipelineName, branch, sourceRepoUrl, elestioConfig, force }) {
  log('info', `Fetching docker-compose from ${TEMPLATE_REPO_OWNER}/${repoName}...`);
  const compose = await fetchCompose(sourceRepoUrl, branch, projectId);
  log('success', 'Compose file loaded');

  // Checked before anything is created: without these files the containers
  // fail ~40s into the build with an opaque "not a directory" from runc.
  const fileMounts = repoFileMounts(compose);
  if (fileMounts.length > 0 && !force) {
    throw new Error(
      `"${repoName}" bind-mounts ${fileMounts.length} file(s) that will not exist on the compose route ` +
      `(${fileMounts.join(', ')}): either they ship in the template repo, or its install scripts create them ` +
      '(Kafka generates its jaas/ files in preInstall). This route has no checkout and runs no install ' +
      'script, so Docker creates each path as an empty directory and the container fails to start. The Git ' +
      'route would handle both, but the Elestio API does not expose it today: deploy this software from the ' +
      'dashboard, or as a managed service. --force deploys anyway, and will most likely fail.'
    );
  }

  const hooks = installHooks(elestioConfig);
  if (hooks.length > 0) log('warn', lifecycleWarning(repoName, hooks));

  return buildComposePipelinePayload({
    target, projectId, pipelineName, compose, elestioConfig
  });
}

function hasLifecycleHooks(elestioConfig) {
  return Object.values(elestioConfig.lifeCycleCommand).some(v => v && v !== '');
}

/**
 * Install hooks live in the template repo, which the compose route never
 * checks out, so they are skipped. Every catalog template declares them, and
 * plenty deploy perfectly without them (vaultwarden, redis and metabase were
 * verified live), so this reports rather than refuses: what the scripts
 * actually do cannot be read, the repos are private to Elestio.
 */
export function installHooks(elestioConfig) {
  return Object.entries(elestioConfig.lifeCycleCommand || {})
    .filter(([name, value]) => value && value !== '' && /^(pre|post)Install/.test(name))
    .map(([name, value]) => `${name}=${value}`);
}

export function lifecycleWarning(repoName, hooks) {
  return `"${repoName}" declares install scripts the compose route cannot run (${hooks.join(', ')}). ` +
    'Whatever they set up is skipped: an admin account, initial data or a sign-up lockdown may be missing. ' +
    'Check the software once deployed; if it needs them, deploy it as a managed service instead.';
}

function collectOverrides(options) {
  const overrides = {};
  if (options.buildCmd !== undefined) overrides.buildCmd = options.buildCmd;
  if (options.runCmd !== undefined) overrides.runCmd = options.runCmd;
  if (options.installCmd !== undefined) overrides.installCmd = options.installCmd;
  if (options.buildDir !== undefined) overrides.buildDir = options.buildDir;
  if (options.variables !== undefined) overrides.variables = options.variables;
  return overrides;
}

function printPlan({ template, repoName, pipelineName, target, elestioConfig, route, branch }) {
  console.log(`\n${colors.bold}Pipeline Preview (--dry-run)${colors.reset}\n`);
  console.log(`  Software:   ${colors.cyan}${template.title}${colors.reset} (ID: ${template.id})`);
  console.log(`  Template:   ${TEMPLATE_REPO_OWNER}/${repoName} @ ${branch}`);
  console.log(`  Pipeline:   ${pipelineName}`);
  console.log(`  Target:     ${target.displayName} (${target.vmID})`);
  const routes = {
    repo: 'repo (Elestio clones the template repo on the VM, install scripts run)',
    inline: 'inline compose (no checkout: install scripts skipped, mounted files missing)',
    git: 'git (repo generated in your account, install scripts run)'
  };
  console.log(`  Route:      ${routes[route]}`);
  console.log(`  Runtime:    ${elestioConfig.config.runTime || 'N/A'}`);
  console.log(`  Ports:      ${elestioConfig.ports.map(p => `${p.listeningPort}->${p.targetPort}`).join(', ') || 'default'}`);
  console.log(`  Env vars:   ${elestioConfig.variables ? elestioConfig.variables.split('\n').map(v => v.split('=')[0]).join(', ') : 'none'}`);
  if (hasLifecycleHooks(elestioConfig)) {
    const hooks = Object.entries(elestioConfig.lifeCycleCommand).filter(([, v]) => v).map(([k]) => k);
    console.log(`  Lifecycle:  ${hooks.join(', ')}`);
  }
  console.log('');
}

function printAccess(elestioConfig, subs, target) {
  const vars = Object.fromEntries(
    (elestioConfig.variables || '').split('\n').filter(Boolean).map(line => {
      const eq = line.indexOf('=');
      return [line.slice(0, eq), line.slice(eq + 1)];
    })
  );

  if (elestioConfig.webUI.length > 0) {
    console.log(`\n${colors.bold}Access${colors.reset}\n`);
    for (const ui of elestioConfig.webUI) {
      // webUI references env vars by name, e.g. password: "[ADMIN_PASSWORD]"
      const resolve = (v) => String(v || '').replace(/\[([A-Z0-9_]+)\]/g, (m, key) => vars[key] ?? m);
      console.log(`  ${colors.bold}${ui.label || 'Web UI'}${colors.reset}`);
      console.log(`    URL:      ${colors.cyan}${resolve(ui.url)}${colors.reset}`);
      if (ui.login) console.log(`    User:     ${resolve(ui.login)}`);
      if (ui.password) console.log(`    Password: ${resolve(ui.password)}`);
    }
    console.log(`\n  ${colors.dim}[CI_CD_DOMAIN] resolves once the pipeline has deployed.${colors.reset}`);
  }

  console.log(`\n  Follow the build: ${colors.cyan}elestio cicd pipelines ${target.vmID}${colors.reset}\n`);
}
