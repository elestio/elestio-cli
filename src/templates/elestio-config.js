import { randomInt } from 'crypto';

/**
 * Reading and applying `elestio.yml`, the file every repo under
 * github.com/elestio-examples carries to describe how it must be deployed.
 *
 * The backend parses the YAML for us (`getGitContent` with file="elestio"),
 * so this module only normalises the resulting object and resolves the
 * placeholders the dashboard resolves at pipeline-creation time.
 */

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHANUM[randomInt(ALPHANUM.length)];
  return out;
}

/**
 * Same shape as the dashboard's generated app password: 8-4-8, guaranteed to
 * mix cases and digits so it satisfies the software's own password policies.
 */
export function generateAppPassword() {
  for (;;) {
    const password = `${randomString(8)}-${randomString(4)}-${randomString(8)}`;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password)) {
      return password;
    }
  }
}

export function generateShortPassword() {
  return `${randomString(8)}-${randomString(7)}`;
}

/**
 * Placeholders resolved when the pipeline is created.
 *
 * `[CI_CD_DOMAIN]` is deliberately left untouched: the pipeline's CNAME does
 * not exist yet at this point, and the deployment agent substitutes it later.
 * The dashboard behaves the same way.
 */
export function createSubstitutions(email) {
  return {
    password: generateAppPassword(),
    shortPassword: generateShortPassword(),
    email: email || ''
  };
}

export function substitute(value, subs) {
  if (typeof value !== 'string') return value;
  // `random_password_16` must be replaced first, otherwise `random_password`
  // matches its prefix and leaves a dangling `_16`.
  return value
    .replaceAll('random_password_16', subs.shortPassword)
    .replaceAll('random_password', subs.password)
    .replaceAll('[EMAIL]', subs.email);
}

function substituteDeep(node, subs) {
  if (Array.isArray(node)) return node.map(item => substituteDeep(item, subs));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substituteDeep(v, subs)]));
  }
  return substitute(node, subs);
}

/** Keys that mean the repo really does carry an elestio.yml. */
const CONFIG_KEYS = ['config', 'environments', 'ports', 'exposedPorts', 'lifeCycleConfig', 'copyCommandConfig', 'webUI'];

const EMPTY_LIFECYCLE = {
  preInstallCommand: '', postInstallCommand: '',
  preBackupCommand: '', postBackupCommand: '',
  preRestoreCommand: '', postRestoreCommand: '',
  preUpdateCommand: '', postUpdateCommand: '',
  preDeployCommand: '', postDeployCommand: ''
};

/**
 * `environments: [{key, value}]` becomes the newline-separated string the
 * backend expects -- it calls variables.trim(), so an array raises a 500.
 */
export function environmentsToVariables(environments, subs) {
  if (!Array.isArray(environments)) return '';

  return environments
    .filter(env => env && env.key !== undefined && env.key !== null && env.key !== '')
    .map(env => `${env.key}=${substitute(String(env.value ?? ''), subs)}`)
    .join('\n');
}

function normalizePort(port) {
  return {
    protocol: String(port.protocol || 'HTTPS').toUpperCase(),
    targetProtocol: String(port.targetProtocol || 'HTTP').toUpperCase(),
    listeningPort: String(port.listeningPort || '443'),
    targetPort: String(port.targetPort || '3000'),
    targetIP: port.targetIP || '172.17.0.1',
    public: port.public !== false,
    path: port.path || '/',
    isAuth: port.isAuth === true,
    login: port.login || '',
    password: port.password || '',
    loginTitle: port.loginTitle || ''
  };
}

function normalizeExposedPort(port) {
  return {
    protocol: String(port.protocol || 'HTTP').toUpperCase(),
    hostPort: String(port.hostPort ?? port.targetPort ?? '3000'),
    containerPort: String(port.containerPort ?? port.targetPort ?? '3000'),
    interface: port.interface || '172.17.0.1'
  };
}

/**
 * Turns a parsed elestio.yml into the pieces a pipeline payload needs.
 *
 * @param {object} raw     parsed elestio.yml (may be null for repos without one)
 * @param {object} subs    from createSubstitutions()
 */
export function normalizeElestioConfig(raw, subs) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const config = substituteDeep(source.config || {}, subs);
  const ports = Array.isArray(source.ports) ? substituteDeep(source.ports, subs).map(normalizePort) : [];
  const exposedPorts = Array.isArray(source.exposedPorts)
    ? substituteDeep(source.exposedPorts, subs).map(normalizeExposedPort)
    : [];

  return {
    // A repo with no elestio.yml still answers 200, with {"status":"ok"} and
    // nothing else -- so presence is decided on the config keys themselves.
    // Treating that reply as a config is what builds a pipeline that runs
    // nothing.
    hasConfig: CONFIG_KEYS.some(key => source[key] !== undefined && source[key] !== null),
    config: {
      runTime: config.runTime || '',
      version: config.version === undefined || config.version === null ? '' : String(config.version),
      framework: config.framework || 'NoFramework',
      buildDir: normalizeDir(config.buildDir, '/'),
      rootDir: normalizeDir(config.rootDir, '/'),
      buildCmd: config.buildCommand || '',
      runCmd: config.runCommand || '',
      installCmd: config.installCommand || '',
      isMonoRepoPackageInRoot: config.isMonoRepoPackageInRoot || false
    },
    ports,
    exposedPorts,
    variables: environmentsToVariables(source.environments, subs),
    lifeCycleCommand: { ...EMPTY_LIFECYCLE, ...substituteDeep(source.lifeCycleConfig || {}, subs) },
    copyCommandConfig: Array.isArray(source.copyCommandConfig) ? substituteDeep(source.copyCommandConfig, subs) : [],
    webUI: Array.isArray(source.webUI) ? substituteDeep(source.webUI, subs) : []
  };
}

function normalizeDir(dir, fallback) {
  if (!dir) return fallback;
  const str = String(dir);
  return str.startsWith('/') ? str : `/${str}`;
}

export { EMPTY_LIFECYCLE };
