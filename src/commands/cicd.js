import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, formatTable, sleep, outputJson } from '../utils.js';
import { getServiceDetails } from './services.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// ── List / Details ──

export async function getCicdServices(projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/cicd/getCICDServices', 'POST', { projectID: String(pid) });
  let services = Array.isArray(response) ? response : (response.data?.services || []);
  if (response.status === 'KO') throw new Error(response.message || 'Failed');

  if (json) { outputJson(services); return services; }
  if (services.length === 0) { log('info', 'No CI/CD targets found'); return []; }

  const columns = [
    { key: 'displayName', label: 'Name' },
    { key: 'vmID', label: 'vmID' },
    { key: 'serverName', label: 'CNAME' },
    { key: 'vmProvider', label: 'Provider' },
    { key: 'vmRegion', label: 'Region' }
  ];

  const data = services.map(s => ({
    displayName: s.displayName || s.name || 'N/A',
    vmID: s.providerServerID || s.vmID || 'N/A',
    serverName: s.serverName || 'N/A',
    vmProvider: s.vmProvider || s.provider || 'N/A',
    vmRegion: s.vmRegion || s.datacenter || 'N/A'
  }));

  console.log(`\n${colors.bold}CI/CD Targets (${services.length})${colors.reset}\n`);
  console.log(formatTable(data, columns));
  console.log('');
  return services;
}

export async function getServicePipelines(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/cicd/getServicePipelines', 'POST', { projectID: String(pid), vmID: String(vmID) });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');

  const pipelines = Array.isArray(response.data) ? response.data : (response.data?.pipelines || []);
  if (json) { outputJson(pipelines); return pipelines; }
  if (pipelines.length === 0) { log('info', `No pipelines on ${vmID}`); return []; }

  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'pipelineName', label: 'Name' },
    { key: 'type', label: 'Mode' },
    { key: 'status', label: 'Status' },
    { key: 'buildStatus', label: 'Build' }
  ];

  console.log(`\n${colors.bold}Pipelines on ${vmID}${colors.reset}\n`);
  console.log(formatTable(pipelines, columns));
  console.log('');
  return pipelines;
}

export async function getPipelineDetails(vmID, pipelineID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/cicd/getPipelineDetails', 'POST', {
    vmID: String(vmID), projectID: String(pid), pipelineID: parseInt(pipelineID)
  });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');

  const pipeline = response.data;
  if (json) { outputJson(pipeline); return pipeline; }

  console.log(`\n${colors.bold}Pipeline ${pipelineID}${colors.reset}\n`);
  console.log(`  Name: ${pipeline.name || 'N/A'}`);
  console.log(`  Mode: ${pipeline.CICDMode || 'N/A'}`);
  console.log(`  Status: ${pipeline.status || 'N/A'}`);
  console.log(`  URL: ${pipeline.url || 'N/A'}`);
  if (pipeline.gitData) {
    console.log(`  Repo: ${pipeline.gitData.repoUrl || 'N/A'}`);
    console.log(`  Branch: ${pipeline.gitData.branch || 'N/A'}`);
  }
  console.log('');
  return pipeline;
}

// ── Pipeline Actions ──

export async function doActionOnPipeline(vmID, pipelineID, action, additionalParams = {}, projectId = null) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/cicd/doActionOnPipeline', 'POST', {
    vmID: String(vmID), projectID: String(pid), pipelineID: parseInt(pipelineID), action, ...additionalParams
  });

  if (response.status !== 'OK' && !response.action) throw new Error(response.message || `Action "${action}" failed`);
  return response;
}

export async function restartPipeline(vmID, pipelineID, projectId) {
  log('info', `Restarting pipeline ${pipelineID}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'restartAppStack', {}, projectId);
  log('success', 'Pipeline restarted');
  return result;
}

export async function stopPipeline(vmID, pipelineID, projectId) {
  log('info', `Stopping pipeline ${pipelineID}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'stopAppStack', {}, projectId);
  log('success', 'Pipeline stopped');
  return result;
}

export async function deletePipeline(vmID, pipelineID, projectId, force) {
  if (!force) throw new Error('Requires --force flag');
  log('info', `Deleting pipeline ${pipelineID}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'deletePipeline', {}, projectId);
  log('success', 'Pipeline deleted');
  return result;
}

export async function resyncPipeline(vmID, pipelineID, projectId) {
  log('info', `Re-syncing pipeline ${pipelineID}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'reSyncPipeline', {}, projectId);
  log('success', 'Pipeline re-sync initiated');
  return result;
}

export async function getPipelineLogs(vmID, pipelineID, projectId) {
  const result = await doActionOnPipeline(vmID, pipelineID, 'pipelineRunningLogs', {}, projectId);
  if (result.logs) console.log('\n' + result.logs);
  return result;
}

export async function getPipelineHistory(vmID, pipelineID, projectId, json = false) {
  const result = await doActionOnPipeline(vmID, pipelineID, 'getHistory', {}, projectId);
  const history = result.data?.history || result.history || [];
  if (json) { outputJson(history); return history; }
  if (history.length === 0) { log('info', 'No build history'); return []; }

  console.log(`\n${colors.bold}Build History${colors.reset}\n`);
  history.forEach(h => console.log(`  ${h.filepath || h.file}: ${h.status || 'N/A'}`));
  console.log('');
  return history;
}

export async function viewPipelineLog(vmID, pipelineID, filepath, projectId) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/cicd/viewPipelineLog', 'POST', {
    vmID: String(vmID), projectID: String(pid), pipelineID: parseInt(pipelineID), filepath
  });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');
  console.log(response.data?.content || response.content || '');
  return response;
}

// ── Pipeline Domains ──

export async function listPipelineDomains(vmID, pipelineID, projectId, json = false) {
  const result = await doActionOnPipeline(vmID, pipelineID, 'SSLDomainsList', {}, projectId);
  const domains = result.data?.domains || result.domains || [];
  if (json) { outputJson(domains); return domains; }
  if (domains.length === 0) { log('info', 'No custom domains'); return []; }

  console.log(`\n${colors.bold}Pipeline Domains${colors.reset}\n`);
  domains.forEach(d => console.log(`  ${d}`));
  console.log('');
  return domains;
}

export async function addPipelineDomain(vmID, pipelineID, domain, projectId) {
  log('info', `Adding domain ${domain}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'SSLDomainsAdd', { domain }, projectId);
  log('success', `Domain ${domain} added`);
  return result;
}

export async function removePipelineDomain(vmID, pipelineID, domain, projectId) {
  log('info', `Removing domain ${domain}...`);
  const result = await doActionOnPipeline(vmID, pipelineID, 'SSLDomainsRemove', { domain }, projectId);
  log('success', `Domain ${domain} removed`);
  return result;
}

// ── Create Pipeline ──

export async function createPipeline(configFile) {
  if (!configFile || !fs.existsSync(configFile)) throw new Error(`Config file not found: ${configFile}`);

  const pipelineConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  log('info', 'Creating pipeline...');
  const response = await apiRequest('/api/cicd/createCiCdExistServer', 'POST', pipelineConfig);

  if (response.status !== 'OK' && !response.providerServerID) throw new Error(response.message || 'Failed');

  log('success', 'Pipeline created');
  log('info', `  Service: ${response.serviceName || 'N/A'}`);
  return response;
}

// ── Auto-create Pipeline ──

async function findGitAuthID(gitType, projectId) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;

  try {
    const cicdResp = await apiRequest('/api/cicd/getCICDServices', 'POST', { projectID: String(pid) });
    const cicdServices = Array.isArray(cicdResp) ? cicdResp : (cicdResp.data?.services || []);
    for (const svc of cicdServices) {
      const vmID = svc.providerServerID || svc.vmID;
      try {
        const pipResp = await apiRequest('/api/cicd/getServicePipelines', 'POST', { projectID: String(pid), vmID: String(vmID) });
        const pipelines = Array.isArray(pipResp.data) ? pipResp.data : (pipResp.data?.pipelines || []);
        for (const p of pipelines) {
          if (p.type === gitType || p.mode === gitType) {
            const det = await apiRequest('/api/cicd/getPipelineDetails', 'POST', { vmID: String(vmID), projectID: String(pid), pipelineID: p.id });
            if (det.status === 'OK' && det.data?.authID) return String(det.data.authID);
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

async function getCicdTargetInfo(vmID, projectId) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;

  const response = await apiRequest('/api/cicd/getCICDServices', 'POST', { projectID: String(pid) });
  const services = Array.isArray(response) ? response : (response.data?.services || []);
  const target = services.find(s => String(s.providerServerID) === String(vmID) || String(s.vmID) === String(vmID));
  if (!target) throw new Error(`CI/CD target ${vmID} not found`);

  return {
    displayName: target.displayName || target.name,
    id: String(target.id || target.serverID),
    serverName: target.serverName || '',
    vmID: String(target.providerServerID || target.vmID)
  };
}

const RUNTIME_PRESETS = {
  'static': { runtime: 'staticSPA', buildDir: '/dist', framework: 'Vite.js', buildCmd: 'npm run build', runCmd: '', installCmd: 'npm install', version: '20', containerPort: '3000' },
  'node': { runtime: 'node', buildDir: '/', framework: 'No Framework', buildCmd: 'npm run build', runCmd: 'npm start', installCmd: 'npm install', version: '20', containerPort: '3000' },
  'docker': { runtime: '', buildDir: '/', framework: '', buildCmd: '', runCmd: '', installCmd: '', version: '', containerPort: '80' }
};

export async function autoCreatePipeline(options = {}) {
  const config = loadConfig();
  const pid = options.project || config.defaultProject;
  if (!pid) throw new Error('Project ID required');
  if (!options.target) throw new Error('CI/CD target vmID required (--target)');
  if (!options.name) throw new Error('Pipeline name required (--name)');

  const mode = options.mode || 'github';
  let gitType, appType;

  if (mode === 'docker') { gitType = null; appType = 'docker'; }
  else if (mode.startsWith('gitlab')) { gitType = 'GITLAB'; appType = mode === 'gitlab-fullstack' ? 'node' : 'static'; }
  else { gitType = 'GITHUB'; appType = mode === 'github-fullstack' ? 'node' : 'static'; }

  log('info', 'Getting CI/CD target info...');
  const target = await getCicdTargetInfo(options.target, pid);
  log('success', `Target: ${target.displayName} (${target.vmID})`);

  let authID = options.authId ? String(options.authId) : null;
  let repoData = null;

  if (gitType) {
    if (!options.repo) throw new Error('Repo required (--repo owner/repo)');

    if (!authID) {
      log('info', `Looking for ${gitType} auth...`);
      authID = await findGitAuthID(gitType, pid);
      if (!authID) throw new Error(`No ${gitType} auth found. Connect in dashboard or provide --auth-id`);
    }
    log('success', `Auth ID: ${authID}`);

    const orgsResp = await apiRequest('/api/cicd/getGitOrgs', 'POST', { projectID: String(pid), gitType, authID: String(authID) });
    const orgs = orgsResp.data?.scopeUsers || [];
    if (orgs.length === 0) throw new Error(`No ${gitType} accounts found`);

    const [owner, repoName] = options.repo.split('/');
    const repos = await apiRequest('/api/cicd/getRepoByOrg', 'POST', { projectID: String(pid), gitType, authID: String(authID), orgName: owner, gitUser: owner });
    const repoList = repos.data || repos || [];
    repoData = (Array.isArray(repoList) ? repoList : []).find(r => r.name?.toLowerCase() === repoName?.toLowerCase());
    if (!repoData) throw new Error(`Repo "${repoName}" not found`);
    log('success', `Repo: ${repoData.name}`);
  }

  const preset = RUNTIME_PRESETS[appType] || RUNTIME_PRESETS.static;
  const branch = options.branch || 'main';
  const gitHost = gitType === 'GITLAB' ? 'gitlab.com' : 'github.com';

  const payload = {
    CICDMode: gitType || 'DOCKER',
    pipelineName: options.name,
    projectID: String(pid),
    authID: authID ? String(authID) : '0',
    ports: [{ protocol: 'HTTPS', targetProtocol: 'HTTP', listeningPort: '443', targetPort: '3000', public: true, targetIP: '172.17.0.1', path: '/', isAuth: false, login: '', password: '' }],
    variables: options.variables || '',
    cluster: { isCluster: false, createNew: false, target },
    imageData: gitType ? { isPipelineTemplate: false } : { imageName: options.image || 'nginx', imageTag: options.imageTag || 'alpine', registryUrl: '', isPipelineTemplate: false },
    configData: { buildDir: options.buildDir || preset.buildDir, rootDir: options.rootDir || '/', runtime: preset.runtime, version: options.nodeVersion || preset.version, framework: options.framework || preset.framework, buildCmd: options.buildCmd || preset.buildCmd, runCmd: options.runCmd || preset.runCmd, installCmd: options.installCmd || preset.installCmd },
    gitData: gitType ? { projectName: options.name, branch, repoUrl: `https://${gitHost}/${options.repo}`, cloneUrl: `https://${gitHost}/${options.repo}.git`, repoID: String(repoData.id), repo: options.repo.split('/')[1] } : { projectName: options.name, branch: 'main', repoUrl: '', cloneUrl: '', repoID: 0, repo: '' },
    exposedPorts: [{ protocol: 'HTTP', hostPort: '3000', containerPort: preset.containerPort, interface: '172.17.0.1' }],
    gitVolumeConfig: [],
    isNeedToCreateRepo: !gitType,
    isPublicGitRepo: repoData ? String(!repoData.private) : 'false',
    isMovePipeline: false,
    nonRepoWorkSpaces: [''],
    gitUserFormData: {}
  };

  log('info', 'Creating pipeline...');
  const response = await apiRequest('/api/cicd/createCiCdExistServer', 'POST', payload);
  if (response.status !== 'OK' && !response.providerServerID) throw new Error(response.message || JSON.stringify(response));

  log('success', 'Pipeline created!');
  log('info', `  Name: ${options.name} | Mode: ${mode}`);
  if (gitType) log('info', `  Repo: ${options.repo} (${branch})`);
  return response;
}

// ── Pipeline Template Generator ──

function basePorts(targetPort = '3000') {
  return [{ protocol: 'HTTPS', targetProtocol: 'HTTP', listeningPort: '443', targetPort, public: true, targetIP: '172.17.0.1', path: '/', isAuth: false, login: '', password: '' }];
}

function baseExposedPorts(hostPort = '3000', containerPort = '3000') {
  return [{ protocol: 'HTTP', hostPort, containerPort, interface: '172.17.0.1' }];
}

function baseCluster() {
  return { isCluster: false, createNew: false, target: { displayName: 'REPLACE', id: 'REPLACE', serverName: 'REPLACE', vmID: 'REPLACE' } };
}

export function generatePipelineTemplate(mode = 'docker') {
  const templates = {
    docker: { CICDMode: 'DOCKER', pipelineName: 'REPLACE', projectID: 'REPLACE', ports: basePorts(), variables: '', cluster: baseCluster(), imageData: { imageName: 'nginx', imageTag: 'alpine', registryUrl: '', isPipelineTemplate: false }, configData: { buildDir: '/', rootDir: '/', runtime: '', version: '', framework: '', buildCmd: '', runCmd: '', installCmd: '' }, gitData: { projectName: 'REPLACE', branch: 'main', repoUrl: '', cloneUrl: '', repoID: 0, repo: '' }, exposedPorts: baseExposedPorts('3000', '80'), isNeedToCreateRepo: true, gitVolumeConfig: [], isMovePipeline: false, nonRepoWorkSpaces: [''], gitUserFormData: {} },
    github: { CICDMode: 'GITHUB', pipelineName: 'REPLACE', projectID: 'REPLACE', ports: basePorts(), variables: '', cluster: baseCluster(), imageData: { isPipelineTemplate: false }, configData: { buildDir: '/dist', rootDir: '/', runtime: 'staticSPA', version: '20', framework: 'Vite.js', buildCmd: 'npm run build', runCmd: '', installCmd: 'npm install' }, gitData: { projectName: 'REPLACE', branch: 'main', repoUrl: 'https://github.com/OWNER/REPO', cloneUrl: 'https://github.com/OWNER/REPO.git', repoID: 'REPLACE', repo: 'OWNER/REPO' }, exposedPorts: baseExposedPorts(), isNeedToCreateRepo: false, isPublicGitRepo: 'false', gitVolumeConfig: [], isMovePipeline: false, nonRepoWorkSpaces: [''], gitUserFormData: {} }
  };

  templates['github-fullstack'] = { ...templates.github, configData: { buildDir: '/', rootDir: '/', runtime: 'node', version: '20', framework: 'No Framework', buildCmd: 'npm run build', runCmd: 'npm start', installCmd: 'npm install' } };
  templates.gitlab = { ...templates.github, CICDMode: 'GITLAB', gitData: { ...templates.github.gitData, repoUrl: 'https://gitlab.com/OWNER/REPO', cloneUrl: 'https://gitlab.com/OWNER/REPO.git' } };
  templates['gitlab-fullstack'] = { ...templates['github-fullstack'], CICDMode: 'GITLAB', gitData: { ...templates.github.gitData, repoUrl: 'https://gitlab.com/OWNER/REPO', cloneUrl: 'https://gitlab.com/OWNER/REPO.git' } };

  if (!templates[mode]) {
    const available = Object.keys(templates).join(', ');
    throw new Error(`Unknown mode "${mode}". Available: ${available}`);
  }

  return JSON.stringify(templates[mode], null, 2);
}

// ── Docker Registries ──

export async function addDockerRegistry(projectId, identityName, username, password, url) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;

  const response = await apiRequest('/api/cicd/addDockerRegistry', 'POST', { projectID: String(pid), identityName, username, password, url });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');

  log('success', `Docker registry "${identityName}" added`);
  return response;
}

export async function getDockerRegistries(projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;

  const response = await apiRequest('/api/cicd/getDockerRegistry', 'GET', { projectID: String(pid) });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed');

  const registries = response.data?.registries || [];
  if (json) { outputJson(registries); return registries; }
  if (registries.length === 0) { log('info', 'No Docker registries'); return []; }

  console.log(`\n${colors.bold}Docker Registries${colors.reset}\n`);
  registries.forEach(r => console.log(`  ${r.identityName}: ${r.url}`));
  console.log('');
  return registries;
}
