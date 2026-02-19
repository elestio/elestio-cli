import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, outputJson } from '../utils.js';
import { getServiceDetails } from './services.js';

export async function getCredentials(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const serviceInfo = await getServiceDetails(vmID, pid);
  if (!serviceInfo) throw new Error('Failed to get service details');

  const targetPort = serviceInfo.adminInternalPort || 8080;
  const srvPort = serviceInfo.adminExternalPort || 443;

  const response = await apiRequest('/api/servers/getAppCredentials', 'POST', {
    vmID: String(vmID), targetPort, srvPort,
    projectID: String(pid), appID: 'CloudVM',
    isServerDeleted: false, mode: 'dbAdmin'
  });

  if (!response.url) throw new Error(response.message || 'Failed to get credentials');

  if (json) {
    outputJson({
      service: { name: serviceInfo.displayName, type: serviceInfo.serverType, ip: serviceInfo.ipv4 },
      credentials: { url: response.url, user: response.user, password: response.password },
      database: serviceInfo.managedDBPort ? {
        host: serviceInfo.cname, port: serviceInfo.managedDBPort
      } : null
    });
    return response;
  }

  console.log(`\n${colors.bold}Service Info${colors.reset}\n`);
  console.log(`  Name:     ${serviceInfo.displayName}`);
  console.log(`  Type:     ${serviceInfo.serverType} (${serviceInfo.cores} CPU / ${serviceInfo.ramGB} GB RAM)`);
  console.log(`  Status:   ${serviceInfo.status}`);
  console.log(`  IP:       ${serviceInfo.ipv4}`);
  console.log(`\n${colors.bold}App Credentials${colors.reset}\n`);
  console.log(`  URL:      ${colors.cyan}${response.url}${colors.reset}`);
  console.log(`  User:     ${response.user || 'N/A'}`);
  console.log(`  Password: ${response.password || 'N/A'}`);

  if (serviceInfo.managedDBPort) {
    console.log(`\n${colors.bold}Database Connection${colors.reset}`);
    console.log(`  Host:     ${serviceInfo.cname}`);
    console.log(`  Port:     ${serviceInfo.managedDBPort}`);
  }
  console.log('');
  return response;
}

export async function getSSH(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/startSSHDirect', 'POST', {
    vmID: String(vmID), projectID: String(pid), path: '/root/'
  });

  if (!response.url) throw new Error(response.message || 'Failed to get SSH access');

  if (json) { outputJson({ url: response.url }); return response; }

  console.log(`\n${colors.bold}SSH Access${colors.reset}\n`);
  console.log(`  Web Terminal: ${colors.cyan}${response.url}${colors.reset}`);
  console.log('');
  return response;
}

export async function getSSHDirect(vmID, json = false) {
  const response = await apiRequest('/api/servers/startSSHDirect', 'POST', { vmID: String(vmID) });
  if (response.status !== 'OK' && !response.ip) throw new Error(response.message || 'Failed to get SSH info');

  if (json) {
    outputJson({ host: response.ip || response.host, port: response.port || 22, user: response.user || 'root' });
    return response;
  }

  console.log(`\n${colors.bold}Direct SSH${colors.reset}\n`);
  console.log(`  Host: ${response.ip || response.host || 'N/A'}`);
  console.log(`  Port: ${response.port || 22}`);
  console.log(`  User: ${response.user || 'root'}`);
  console.log(`\n  ${colors.dim}ssh ${response.user || 'root'}@${response.ip || response.host} -p ${response.port || 22}${colors.reset}`);
  console.log('');
  return response;
}

export async function getVSCode(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/startVSCode', 'POST', {
    vmID: String(vmID), projectID: String(pid)
  });

  if (!response.url) throw new Error(response.message || 'Failed to get VSCode access');

  if (json) { outputJson({ url: response.url, user: response.user, password: response.password }); return response; }

  console.log(`\n${colors.bold}VSCode Web Access${colors.reset}\n`);
  console.log(`  URL:      ${colors.cyan}${response.url}${colors.reset}`);
  console.log(`  User:     ${response.user || 'N/A'}`);
  console.log(`  Password: ${response.password || 'N/A'}`);
  console.log('');
  return response;
}

export async function getFileExplorer(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/startFileExplorer', 'POST', {
    vmID: String(vmID), projectID: String(pid)
  });

  if (!response.url) throw new Error(response.message || 'Failed to get File Explorer access');

  if (json) { outputJson({ url: response.url, user: response.user, password: response.password }); return response; }

  console.log(`\n${colors.bold}File Explorer Access${colors.reset}\n`);
  console.log(`  URL:      ${colors.cyan}${response.url}${colors.reset}`);
  console.log(`  User:     ${response.user || 'N/A'}`);
  console.log(`  Password: ${response.password || 'N/A'}`);
  console.log('');
  return response;
}
