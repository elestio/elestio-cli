import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { colors, outputJson, formatTable, log } from '../utils.js';
import { getServiceDetails, listServicesRaw } from './services.js';

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

/**
 * `--direct` prints the details for connecting with a local ssh client.
 *
 * These come from the service record: /api/servers/startSSHDirect returns a
 * browser terminal URL, not host/port/user, so it cannot answer this.
 */
export async function getSSHDirect(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const service = await getServiceDetails(vmID, pid);
  if (!service) throw new Error(`Service with vmID ${vmID} not found`);

  const host = service.ipv4 || service.cname;
  if (!host) throw new Error(`Service ${vmID} has no IP yet; it may still be deploying`);

  const details = { host, port: 22, user: 'root', command: `ssh root@${host}` };

  if (json) { outputJson(details); return details; }

  console.log(`\n${colors.bold}Direct SSH${colors.reset}\n`);
  console.log(`  Host: ${host}`);
  console.log(`  Port: 22`);
  console.log(`  User: root`);
  console.log(`\n  ${colors.cyan}${details.command}${colors.reset}`);
  console.log(`\n  ${colors.dim}Add your key first: elestio ssh-keys add ${vmID} --name <n> --key "$(awk '{print $1" "$2}' ~/.ssh/id_ed25519.pub)"${colors.reset}`);
  console.log('');
  return details;
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

/**
 * startLogTailView modes, as the backend whitelists them. "syslog" streams the
 * app's `docker-compose logs` and is what the dashboard's Logs tab uses; an
 * empty mode is the install log. "docker" is not accepted.
 */
export const LOG_MODES = { app: 'syslog', install: '', resync: 'resyncLog', alerts: 'alertLog', 'db-migration': 'db-migration-logs' };
const RAW_LOG_MODES = Object.values(LOG_MODES);

export function resolveLogMode(mode = 'app') {
  if (mode in LOG_MODES) return LOG_MODES[mode];
  if (RAW_LOG_MODES.includes(mode)) return mode;
  throw new Error(`Unknown log mode "${mode}". Use one of: ${Object.keys(LOG_MODES).join(', ')}`);
}

/**
 * Live log view. The API opens a temporary web page streaming the logs rather
 * than returning them, like the dashboard's "Logs" tab.
 */
export async function getLogsView(vmID, projectId = null, mode = 'app', json = false) {
  const pid = projectId || loadConfig().defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/startLogTailView', 'POST', {
    vmID: String(vmID), projectID: String(pid), mode: resolveLogMode(mode)
  });
  if (!response.url) throw new Error(response.message || 'Failed to open the log view');

  if (json) { outputJson({ url: response.url, user: response.user, password: response.password }); return response; }

  console.log(`\n${colors.bold}Live logs (${mode})${colors.reset}\n`);
  console.log(`  URL:      ${colors.cyan}${response.url}${colors.reset}`);
  if (response.user) console.log(`  User:     ${response.user}`);
  if (response.password) console.log(`  Password: ${response.password}`);
  console.log(`\n  ${colors.dim}Temporary page. --mode install for the installation log.${colors.reset}\n`);
  return response;
}

export function formatAudit(a) {
  return {
    when: String(a.time || a.timestamp || 'N/A').replace('T', ' ').slice(0, 19),
    event: [a.event_category, a.event_type].filter(Boolean).join(' / ') || a.event || 'N/A',
    user: a.email || a.userEmail || 'N/A',
    details: String(a.event_details || a.details || '').slice(0, 60)
  };
}

/** Audit trail of a service: who did what, over the last N days. */
export async function getAudits(vmID, projectId = null, days = 30, json = false) {
  const pid = projectId || loadConfig().defaultProject;
  if (!pid) throw new Error('Project ID required');

  // getAudits takes serverIDs, not vmIDs.
  const service = (await listServicesRaw(pid)).find(s => String(s.vmID) === String(vmID) || String(s.id) === String(vmID));
  if (!service) throw new Error(`Service ${vmID} not found in project ${pid}`);

  const end = new Date();
  const start = new Date(end.getTime() - Number(days) * 24 * 60 * 60 * 1000);
  const response = await apiRequest('/api/servers/getAudits', 'POST', {
    serverIDs: [String(service.id)], projectID: String(pid),
    startDate: start.toISOString(), endDate: end.toISOString()
  });
  if (response.status === 'KO' || response.status === 'error') throw new Error(response.message || 'Failed to fetch audits');

  // Entries come back as a bare array in data: {status, count, data: [...]}.
  const audits = Array.isArray(response.data) ? response.data : (response.data?.audits || response.audits || []);
  if (json) { outputJson(audits); return audits; }
  if (audits.length === 0) { log('info', `No audit entries in the last ${days} days`); return []; }

  console.log(`\n${colors.bold}Audit trail of ${vmID} (last ${days} days)${colors.reset}\n`);
  console.log(formatTable(audits.map(formatAudit), [
    { key: 'when', label: 'When' },
    { key: 'event', label: 'Event' },
    { key: 'user', label: 'User' },
    { key: 'details', label: 'Details' }
  ]));
  console.log('');
  return audits;
}
