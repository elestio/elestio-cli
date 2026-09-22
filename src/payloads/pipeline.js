import { RUNTIME_PRESETS } from '../constants.js';
import { EMPTY_LIFECYCLE } from '../templates/elestio-config.js';

/**
 * Builders for POST /api/cicd/createCiCdExistServer.
 *
 * The endpoint takes the dashboard's whole form state, so most of this file is
 * the inert scaffolding it expects. Keep it in one place: every divergence
 * between what we send and what the dashboard sends has produced a 500.
 */

export function emptyGitUserFormData() {
  return {
    selectedUser: '', searchGitUser: '',
    gitOrgsFilteredList: { GITHUB: [], GITLAB: [] },
    gitOrgsList: [], selectedRepo: {},
    thirdPartyRepoInput: '', gitScopesUsers: [],
    thirdPartyRepoScopeName: '',
    getGitScopeUser: { GITHUB: [], GITLAB: [] },
    thirdPartyRepoName: '', thirdPartyRepoPrivate: false,
    loadSearch: false
  };
}

export function defaultPorts(targetPort = 3001) {
  return [{
    protocol: 'HTTPS', targetProtocol: 'HTTP', listeningPort: '443',
    targetPort: String(targetPort), public: true, targetIP: '172.17.0.1',
    path: '/', isAuth: false, login: '', password: '', loginTitle: ''
  }];
}

export function defaultExposedPorts(hostPort = '3000', containerPort = '3000') {
  return [{ protocol: 'HTTP', hostPort: String(hostPort), containerPort: String(containerPort), interface: '172.17.0.1' }];
}

/**
 * @param {object} opts
 * @param {object} opts.target          CI/CD target, from resolveCicdTarget()
 * @param {string} opts.projectId
 * @param {string} opts.pipelineName
 * @param {string} opts.cicdMode        GITHUB | GITLAB | DockerCompose
 * @param {object} [opts.gitData]
 * @param {object} [opts.imageData]
 * @param {object} [opts.configData]
 * @param {Array}  [opts.ports]
 * @param {Array}  [opts.exposedPorts]
 * @param {string} [opts.variables]     newline-separated KEY=VALUE, never an array
 * @param {object} [opts.lifeCycleCommand]
 * @param {Array}  [opts.copyCommandConfig]
 * @param {string|null} [opts.authID]
 * @param {boolean} [opts.isPublicGitRepo]
 * @param {boolean} [opts.isNeedToCreateRepo]
 */
export function buildPipelinePayload(opts) {
  const {
    target, projectId, pipelineName, cicdMode,
    gitData = {}, imageData = {}, configData = {},
    ports, exposedPorts, variables = '',
    lifeCycleCommand = {}, copyCommandConfig = [],
    authID = null, isPublicGitRepo = false, isNeedToCreateRepo = false
  } = opts;

  if (!target) throw new Error('A CI/CD target is required');
  if (!projectId) throw new Error('Project ID is required');
  if (!pipelineName) throw new Error('Pipeline name is required');

  return {
    cluster: { isCluster: false, createNew: false, target },
    gitData,
    imageData,
    configData: {
      buildDir: configData.buildDir || '/',
      rootDir: configData.rootDir || '/',
      runTime: configData.runTime || 'NodeJs',
      buildCmd: configData.buildCmd || '',
      runCmd: configData.runCmd || '',
      installCmd: configData.installCmd || '',
      framework: configData.framework || 'NoFramework',
      version: configData.version === undefined || configData.version === null ? '' : String(configData.version)
    },
    ports: ports && ports.length > 0 ? ports : defaultPorts(),
    // The backend runs variables.trim(); anything but a string is a 500.
    variables: typeof variables === 'string' ? variables : '',
    isPublicGitRepo,
    exposedPorts: exposedPorts && exposedPorts.length > 0 ? exposedPorts : defaultExposedPorts(),
    gitVolumeConfig: [{}],
    isNeedToCreateRepo,
    gitUserFormData: emptyGitUserFormData(),
    lifeCycleCommand: { ...EMPTY_LIFECYCLE, ...lifeCycleCommand },
    monoRepoWorkSpaces: [''],
    copyCommandConfig,
    CICDMode: cicdMode,
    projectID: String(projectId),
    pipelineName,
    isMovePipeline: false,
    authID: authID === null || authID === undefined ? null : String(authID)
  };
}

/**
 * Pipeline running a Git repo, configured from the repo's elestio.yml when it
 * has one and from the runtime preset otherwise.
 */
export function buildGitPipelinePayload({
  target, projectId, pipelineName, gitType, repo, branch, repoID,
  elestioConfig, authID, isPublicGitRepo, isNeedToCreateRepo, appType = 'static', overrides = {}
}) {
  const preset = RUNTIME_PRESETS[appType] || RUNTIME_PRESETS.static;
  const gitHost = gitType === 'GITLAB' ? 'gitlab.com' : 'github.com';
  const repoName = repo.split('/')[1];
  const fromFile = elestioConfig && elestioConfig.hasConfig ? elestioConfig : null;

  const configData = {
    runTime: overrides.runTime || fromFile?.config.runTime || preset.runtime,
    version: overrides.nodeVersion ?? fromFile?.config.version ?? preset.version,
    framework: overrides.framework || fromFile?.config.framework || preset.framework,
    buildDir: overrides.buildDir || fromFile?.config.buildDir || preset.buildDir,
    rootDir: overrides.rootDir || fromFile?.config.rootDir || '/',
    buildCmd: overrides.buildCmd ?? fromFile?.config.buildCmd ?? preset.buildCmd,
    runCmd: overrides.runCmd ?? fromFile?.config.runCmd ?? preset.runCmd,
    installCmd: overrides.installCmd ?? fromFile?.config.installCmd ?? preset.installCmd
  };

  return buildPipelinePayload({
    target, projectId, pipelineName,
    cicdMode: gitType,
    gitData: {
      projectName: pipelineName,
      branch,
      repoUrl: `https://${gitHost}/${repo}`,
      cloneUrl: `https://${gitHost}/${repo}.git`,
      repoID: repoID === undefined || repoID === null ? '' : String(repoID),
      repo: repoName,
      ...(isNeedToCreateRepo ? { createFromTemplate: true, gitTemplateName: repoName } : {})
    },
    imageData: { isPipelineTemplate: false },
    configData,
    ports: overrides.ports || fromFile?.ports,
    exposedPorts: overrides.exposedPorts || fromFile?.exposedPorts,
    variables: overrides.variables ?? fromFile?.variables ?? '',
    lifeCycleCommand: fromFile?.lifeCycleCommand,
    copyCommandConfig: fromFile?.copyCommandConfig || [],
    authID,
    isPublicGitRepo: !!isPublicGitRepo,
    isNeedToCreateRepo: !!isNeedToCreateRepo
  });
}

/**
 * Pipeline running an inline docker-compose file, with no Git repo attached.
 *
 * Lifecycle hooks are deliberately dropped. There is no checkout, so the paths
 * in elestio.yml do not exist, and the deployment agent chmods them before it
 * runs anything: sending them fails the build with
 * "chmod: cannot access './scripts/preInstall.sh'" before docker compose is
 * even reached. Sending none lets the stack come up.
 */
export function buildComposePipelinePayload({
  target, projectId, pipelineName, compose, elestioConfig, overrides = {}
}) {
  if (!compose) throw new Error('A docker-compose file is required for DockerCompose mode');
  const fromFile = elestioConfig && elestioConfig.hasConfig ? elestioConfig : null;

  return buildPipelinePayload({
    target, projectId, pipelineName,
    cicdMode: 'DockerCompose',
    gitData: {},
    imageData: { isPrivate: false, compose, dockerExample: '', repoName: 'CustomDocker' },
    configData: {
      runTime: 'NodeJs', framework: 'NoFramework', version: '20',
      buildDir: '/', rootDir: '/', buildCmd: '', runCmd: '', installCmd: ''
    },
    ports: overrides.ports || fromFile?.ports,
    exposedPorts: overrides.exposedPorts || fromFile?.exposedPorts,
    variables: overrides.variables ?? fromFile?.variables ?? '',
    lifeCycleCommand: {},
    copyCommandConfig: fromFile?.copyCommandConfig || [],
    authID: null,
    isPublicGitRepo: false,
    isNeedToCreateRepo: false
  });
}

export const DEFAULT_COMPOSE = `services:
  nginx:
    image: nginx:alpine
    ports:
      - "172.17.0.1:3000:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro`;
