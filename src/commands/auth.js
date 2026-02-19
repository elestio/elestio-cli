import { loadConfig, saveConfig, saveCredentials, getCredentials, CREDENTIALS_PATH } from '../config.js';
import { authenticate } from '../api.js';
import { log, colors, outputJson } from '../utils.js';

export async function configure(email, token, json) {
  if (!email || !token) {
    throw new Error('Both --email and --token are required');
  }

  log('info', 'Testing authentication...');
  const auth = await authenticate(email, token);

  saveCredentials(email, token);

  const config = loadConfig();
  config.jwt = auth.jwt;
  config.jwtExpiry = auth.jwtExpiry;
  saveConfig(config);

  if (json) {
    outputJson({ status: 'ok', email });
    return true;
  }

  log('success', `Configured for ${email}`);
  log('info', `Credentials saved to ~/.elestio/credentials`);
  return true;
}

export function showConfig(json) {
  const config = loadConfig();
  const creds = getCredentials();

  if (json) {
    outputJson({
      email: creds.email,
      hasToken: !!creds.apiToken,
      hasJwt: !!config.jwt,
      jwtExpiry: config.jwtExpiry ? new Date(config.jwtExpiry).toISOString() : null,
      defaultProject: config.defaultProject,
      defaults: config.defaults
    });
    return;
  }

  console.log(`\n${colors.bold}Elestio Configuration${colors.reset}\n`);
  console.log(`  Email:           ${creds.email || '(not set)'}`);
  console.log(`  API Token:       ${creds.apiToken ? creds.apiToken.slice(0, 8) + '...' : '(not set)'}`);
  console.log(`  Credentials in:  ~/.elestio/credentials`);
  console.log(`  JWT:             ${config.jwt ? 'present (expires ' + new Date(config.jwtExpiry).toISOString() + ')' : '(not set)'}`);
  console.log(`  Default Project: ${config.defaultProject || '(not set)'}`);
  console.log(`\n${colors.bold}Defaults${colors.reset}`);
  console.log(`  Provider:        ${config.defaults?.provider || 'netcup'}`);
  console.log(`  Datacenter:      ${config.defaults?.datacenter || 'nbg'}`);
  console.log(`  Server Type:     ${config.defaults?.serverType || 'MEDIUM-2C-4G'}`);
  console.log(`  Support:         ${config.defaults?.support || 'level1'}`);
  console.log('');
}

export function setDefaultProject(projectId) {
  const config = loadConfig();
  config.defaultProject = String(projectId);
  saveConfig(config);
  log('success', `Default project set to ${projectId}`);
}

export function setDefaults(provider, datacenter, serverType, support) {
  const config = loadConfig();
  if (!config.defaults) config.defaults = {};
  if (provider) config.defaults.provider = provider;
  if (datacenter) config.defaults.datacenter = datacenter;
  if (serverType) config.defaults.serverType = serverType;
  if (support) config.defaults.support = support;
  saveConfig(config);
  log('success', 'Defaults updated');
}

export async function testAuth(json) {
  const creds = getCredentials();

  if (!creds.email || !creds.apiToken) {
    throw new Error('Not configured. Run: elestio login');
  }

  log('info', `Testing authentication for ${creds.email}...`);

  const auth = await authenticate(creds.email, creds.apiToken);
  const config = loadConfig();
  config.jwt = auth.jwt;
  config.jwtExpiry = auth.jwtExpiry;
  saveConfig(config);

  if (json) {
    outputJson({ status: 'ok', email: creds.email, jwtExpiry: new Date(auth.jwtExpiry).toISOString() });
    return true;
  }

  log('success', `Authenticated as ${creds.email}`);
  log('info', `JWT valid until ${new Date(auth.jwtExpiry).toISOString()}`);
  return true;
}

export async function getDefaultProject() {
  const { apiRequest } = await import('../api.js');
  const config = loadConfig();

  if (config.defaultProject) {
    return config.defaultProject;
  }

  const response = await apiRequest('/api/projects/getList');
  if (response.status === 'OK' && response.data?.projects?.length > 0) {
    const firstProject = response.data.projects[0];
    config.defaultProject = String(firstProject.projectID);
    saveConfig(config);
    log('info', `Using project "${firstProject.project_name}" (${firstProject.projectID}) as default`);
    return config.defaultProject;
  }

  throw new Error('No projects found. Create a project first.');
}

export function whoami(json) {
  const creds = getCredentials();
  const config = loadConfig();

  if (!creds.email) {
    throw new Error('Not logged in. Run: elestio login');
  }

  if (json) {
    outputJson({
      email: creds.email,
      defaultProject: config.defaultProject,
      provider: config.defaults?.provider,
      datacenter: config.defaults?.datacenter
    });
    return;
  }

  console.log(`\n${colors.bold}Logged in as${colors.reset} ${colors.cyan}${creds.email}${colors.reset}`);
  if (config.defaultProject) {
    console.log(`  Default project: ${config.defaultProject}`);
  }
  console.log('');
}
