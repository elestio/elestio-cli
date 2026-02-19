import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, formatTable, outputJson } from '../utils.js';
import { getServiceDetails } from './services.js';
import { filterSizes } from './templates.js';
import dns from 'dns/promises';

export async function doAction(vmID, action, additionalParams = {}) {
  const response = await apiRequest('/api/servers/DoActionOnServer', 'POST', {
    vmID: String(vmID), action, ...additionalParams
  });

  if (Array.isArray(response)) return { data: response, status: 'OK' };
  if (response.status === 'KO' || response.status === 'error') {
    throw new Error(response.message || `Action "${action}" failed`);
  }
  return response;
}

// ── Power Management ──

export async function reboot(vmID) {
  log('info', `Rebooting VM ${vmID}...`);
  const result = await doAction(vmID, 'reboot');
  log('success', 'Reboot initiated');
  return result;
}

export async function reset(vmID) {
  log('info', `Hard resetting VM ${vmID}...`);
  const result = await doAction(vmID, 'reset');
  log('success', 'Hard reset initiated');
  return result;
}

const MANAGED_DB_TEMPLATES = ['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'memcached', 'keydb', 'clickhouse', 'couchdb', 'elasticsearch', 'opensearch', 'meilisearch', 'typesense', 'ferretdb'];

export async function shutdown(vmID, options = {}) {
  try {
    const service = await getServiceDetails(vmID, options.project);
    const templateName = (service.templateName || service.displayName || '').toLowerCase();
    if (MANAGED_DB_TEMPLATES.some(db => templateName.includes(db))) {
      throw new Error(`Cannot shutdown managed database "${service.templateName || service.displayName}". Use "reboot" instead.`);
    }
  } catch (e) {
    if (e.message?.includes('Cannot shutdown managed database')) throw e;
  }

  log('info', `Shutting down VM ${vmID}...`);
  const result = await doAction(vmID, 'shutdown');
  log('success', 'Shutdown initiated');
  return result;
}

export async function poweroff(vmID) {
  log('info', `Forcing power off VM ${vmID}...`);
  const result = await doAction(vmID, 'powerOff');
  log('success', 'Power off initiated');
  return result;
}

export async function poweron(vmID) {
  log('info', `Powering on VM ${vmID}...`);
  const result = await doAction(vmID, 'powerOn');
  log('success', 'Power on initiated');
  return result;
}

export async function restartStack(vmID) {
  log('info', `Restarting Docker stack on ${vmID}...`);
  const result = await doAction(vmID, 'restartAppStack');
  log('success', 'Docker stack restart initiated');
  return result;
}

// ── Termination Protection ──

export async function lock(vmID) {
  log('info', `Enabling termination protection on ${vmID}...`);
  const result = await doAction(vmID, 'lock');
  log('success', 'Termination protection enabled');
  return result;
}

export async function unlock(vmID) {
  log('info', `Disabling termination protection on ${vmID}...`);
  const result = await doAction(vmID, 'unlock');
  log('success', 'Termination protection disabled');
  return result;
}

// ── Firewall ──

export async function getFirewallRules(vmID, json = false) {
  const result = await doAction(vmID, 'getFirewallRules');
  const rules = result.data?.rules || result.rules || [];

  if (json) { outputJson(rules); return rules; }

  if (rules.length === 0) { log('info', 'No firewall rules configured'); return rules; }

  const columns = [
    { key: 'type', label: 'Type' },
    { key: 'port', label: 'Port' },
    { key: 'protocol', label: 'Protocol' },
    { key: 'targets', label: 'Targets' }
  ];

  const data = rules.map(r => ({ ...r, targets: Array.isArray(r.targets) ? r.targets.join(', ') : r.targets }));
  console.log(`\n${colors.bold}Firewall Rules${colors.reset}\n`);
  console.log(formatTable(data, columns));
  console.log('');
  return rules;
}

async function mergeFirewallRules(vmID, newRules) {
  let existingRules = [];
  try {
    const result = await doAction(vmID, 'getFirewallRules');
    existingRules = result.data?.rules || result.rules || [];
  } catch { /* no existing */ }

  if (existingRules.length === 0) return newRules;

  const ruleMap = new Map();
  for (const rule of existingRules) ruleMap.set(`${rule.type}|${rule.port}|${rule.protocol}`, rule);
  for (const rule of newRules) ruleMap.set(`${rule.type}|${rule.port}|${rule.protocol}`, rule);
  return Array.from(ruleMap.values());
}

export async function enableFirewall(vmID, rules) {
  if (!rules || !Array.isArray(rules)) {
    throw new Error('Rules array required. Example: [{"type":"INPUT","port":"22","protocol":"tcp","targets":["0.0.0.0/0"]}]');
  }

  let existingRules = [];
  try {
    const result = await doAction(vmID, 'getFirewallRules');
    existingRules = result.data?.rules || result.rules || [];
  } catch { /* not active */ }

  if (existingRules.length > 0) {
    const mergedRules = await mergeFirewallRules(vmID, rules);
    log('info', `Updating firewall on ${vmID}...`);
    const result = await doAction(vmID, 'updateFirewall', { rules: mergedRules });
    log('success', 'Firewall updated');
    return result;
  }

  log('info', `Enabling firewall on ${vmID}...`);
  try {
    const result = await doAction(vmID, 'enableFirewall', { rules });
    log('success', 'Firewall enabled');
    return result;
  } catch {
    const result = await doAction(vmID, 'updateFirewall', { rules });
    log('success', 'Firewall enabled');
    return result;
  }
}

export async function updateFirewall(vmID, rules) {
  if (!rules || !Array.isArray(rules)) throw new Error('Rules array required');
  const mergedRules = await mergeFirewallRules(vmID, rules);
  log('info', `Updating firewall on ${vmID}...`);
  const result = await doAction(vmID, 'updateFirewall', { rules: mergedRules });
  log('success', 'Firewall updated');
  return result;
}

export async function disableFirewall(vmID) {
  log('info', `Disabling firewall on ${vmID}...`);
  const result = await doAction(vmID, 'disableFirewall');
  log('success', 'Firewall disabled');
  return result;
}

// ── SSL / Custom Domains ──

export async function listSslDomains(vmID, json = false) {
  const config = loadConfig();
  const pid = config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/domains/getDomains', 'POST', { projectID: Number(pid) });
  const domains = response.data || [];

  if (json) { outputJson(domains); return domains; }

  if (domains.length === 0) { log('info', 'No custom domains configured'); return domains; }

  console.log(`\n${colors.bold}SSL Domains${colors.reset}\n`);
  domains.forEach(d => console.log(`  ${typeof (d.domain || d.name || d) === 'string' ? (d.domain || d.name || d) : JSON.stringify(d)}`));
  console.log('');
  return domains;
}

export async function addSslDomain(vmID, domain) {
  if (!domain) throw new Error('Domain required');

  try {
    const addresses = await dns.resolve4(domain);
    log('info', `Domain ${domain} resolves to: ${addresses.join(', ')}`);
  } catch (e) {
    if (['ENODATA', 'ENOTFOUND', 'SERVFAIL'].includes(e.code)) {
      throw new Error(`Domain "${domain}" does not resolve. Add an A record pointing to your service IP first.`);
    }
    log('warn', `Could not verify DNS for ${domain}: ${e.code || e.message}`);
  }

  log('info', `Adding SSL domain ${domain} to ${vmID}...`);
  const result = await doAction(vmID, 'SSLDomainsAdd', { domain });
  log('success', `Domain ${domain} added with auto-SSL`);
  return result;
}

export async function removeSslDomain(vmID, domain) {
  if (!domain) throw new Error('Domain required');
  log('info', `Removing SSL domain ${domain} from ${vmID}...`);
  const result = await doAction(vmID, 'SSLDomainsRemove', { domain });
  log('success', `Domain ${domain} removed`);
  return result;
}

// ── SSH Keys ──

export async function listSshKeys(vmID, json = false) {
  const result = await doAction(vmID, 'SSHPubKeysList');
  const keys = Array.isArray(result.data) ? result.data : (result.data?.keys || result.keys || []);

  if (json) { outputJson(keys); return keys; }
  if (keys.length === 0) { log('info', 'No SSH keys configured'); return keys; }

  console.log(`\n${colors.bold}SSH Keys${colors.reset}\n`);
  keys.forEach(k => console.log(`  ${colors.cyan}${k.name}${colors.reset}: ${k.key ? k.key.slice(0, 50) + '...' : 'N/A'}`));
  console.log('');
  return keys;
}

export async function addSshKey(vmID, name, key) {
  if (!name || !key) throw new Error('Both name and key are required');
  log('info', `Adding SSH key "${name}" to ${vmID}...`);
  const result = await doAction(vmID, 'SSHPubKeysAdd', { name, key });
  log('success', `SSH key "${name}" added`);
  return result;
}

export async function removeSshKey(vmID, name) {
  if (!name) throw new Error('Key name required');
  log('info', `Removing SSH key "${name}" from ${vmID}...`);
  const result = await doAction(vmID, 'SSHPubKeysRemove', { deleteParams: name });
  log('success', `SSH key "${name}" removed`);
  return result;
}

// ── Auto-Updates ──

export async function enableSystemAutoUpdate(vmID, options = {}) {
  const { day = 0, hour = 5, minute = 0, securityOnly = true } = options;
  log('info', `Enabling OS auto-updates on ${vmID}...`);
  const result = await doAction(vmID, 'systemAutoUpdateEnable', {
    systemAutoUpdateRebootDayOfWeek: String(day), systemAutoUpdateRebootHour: String(hour),
    systemAutoUpdateRebootMinute: String(minute), systemAutoUpdateSecurityPatchesOnly: securityOnly
  });
  log('success', `OS auto-updates enabled (Day ${day}, ${hour}:${String(minute).padStart(2, '0')})`);
  return result;
}

export async function disableSystemAutoUpdate(vmID) {
  log('info', `Disabling OS auto-updates on ${vmID}...`);
  const result = await doAction(vmID, 'systemAutoUpdateDisable');
  log('success', 'OS auto-updates disabled');
  return result;
}

export async function runSystemUpdate(vmID) {
  log('info', `Running OS update on ${vmID}...`);
  const result = await doAction(vmID, 'systemAutoUpdateNow');
  log('success', 'OS update initiated');
  return result;
}

export async function enableAppAutoUpdate(vmID, options = {}) {
  const { day = 0, hour = 3, minute = 0 } = options;
  log('info', `Enabling app auto-updates on ${vmID}...`);
  const result = await doAction(vmID, 'appAutoUpdateEnable', {
    appAutoUpdateDayOfWeek: String(day), appAutoUpdateHour: String(hour),
    appAutoUpdateMinute: String(minute).padStart(2, '0')
  });
  log('success', `App auto-updates enabled (Day ${day}, ${hour}:${String(minute).padStart(2, '0')})`);
  return result;
}

export async function disableAppAutoUpdate(vmID) {
  log('info', `Disabling app auto-updates on ${vmID}...`);
  const result = await doAction(vmID, 'appAutoUpdateDisable');
  log('success', 'App auto-updates disabled');
  return result;
}

export async function runAppUpdate(vmID) {
  log('info', `Running app update on ${vmID}...`);
  const result = await doAction(vmID, 'appAutoUpdateNow');
  log('success', 'App update initiated');
  return result;
}

export async function changeVersion(vmID, versionTag) {
  if (!versionTag) throw new Error('Version tag required');
  log('info', `Changing version to ${versionTag} on ${vmID}...`);
  const result = await doAction(vmID, 'softwareChangeSelectedVersion', { versionTag });
  log('success', `Version changed to ${versionTag}`);
  return result;
}

// ── Alerts ──

export async function getAlerts(vmID, json = false) {
  const result = await doAction(vmID, 'getAlertsRules');
  const rules = result.data?.rules || result.rules || {};
  if (json) { outputJson(rules); return rules; }
  console.log(`\n${colors.bold}Alert Rules${colors.reset}\n`);
  console.log(JSON.stringify(rules, null, 2));
  console.log('');
  return rules;
}

export async function enableAlerts(vmID, rules, cycleSeconds = 60) {
  if (!rules) throw new Error('Rules configuration required');
  const rulesStr = typeof rules === 'string' ? rules : JSON.stringify(rules);
  log('info', `Updating alerts on ${vmID}...`);
  const result = await doAction(vmID, 'updateAlerts', { monitCycleInSeconds: Number(cycleSeconds), rules: rulesStr });
  log('success', 'Alerts updated');
  return result;
}

export async function disableAlerts(vmID) {
  log('info', `Disabling alerts on ${vmID}...`);
  const result = await doAction(vmID, 'disableAlerts');
  log('success', 'Alerts disabled');
  return result;
}

// ── Resize ──

const DOWNGRADE_SUPPORTED_PROVIDERS = ['netcup', 'aws', 'azure', 'scaleway'];

function parseSizeSpec(sizeName) {
  const cpuMatch = sizeName.match(/(\d+)C/i);
  const ramMatch = sizeName.match(/(\d+)G/i);
  return { cpu: cpuMatch ? parseInt(cpuMatch[1]) : 0, ram: ramMatch ? parseInt(ramMatch[1]) : 0 };
}

function isDowngrade(currentType, newType) {
  const current = parseSizeSpec(currentType);
  const newSpec = parseSizeSpec(newType);
  if (current.cpu === 0 || newSpec.cpu === 0) return false;
  return newSpec.cpu < current.cpu || newSpec.ram < current.ram;
}

async function validateSizeForProvider(newType, providerName, region, currentType) {
  const availableSizes = await filterSizes(providerName);
  const regionSizes = availableSizes.filter(s => s.regionID?.toLowerCase() === region?.toLowerCase());
  const allProviderSizes = regionSizes.length > 0 ? regionSizes : availableSizes;

  const exactMatch = allProviderSizes.find(s => s.title?.toLowerCase() === newType.toLowerCase());
  if (exactMatch) return exactMatch.title;

  const baseName = newType.toUpperCase();
  const candidates = allProviderSizes.filter(s => s.title?.toUpperCase().startsWith(baseName));

  if (candidates.length === 1) {
    log('warn', `Size "${newType}" auto-corrected to "${candidates[0].title}"`);
    return candidates[0].title;
  }

  if (candidates.length > 1) {
    if (currentType) {
      const currentSuffix = currentType.replace(/^.*?(\d+G)/, '').toUpperCase();
      if (currentSuffix) {
        const sameFamilyMatch = candidates.find(s => s.title?.toUpperCase().endsWith(currentSuffix));
        if (sameFamilyMatch) {
          log('warn', `Size auto-corrected to "${sameFamilyMatch.title}"`);
          return sameFamilyMatch.title;
        }
      }
    }
    const options = candidates.map(s => s.title).join(', ');
    throw new Error(`Multiple sizes match "${newType}": ${options}`);
  }

  const uniqueSizes = [...new Map(allProviderSizes.map(s => [s.title, s])).values()];
  const sizeList = uniqueSizes.map(s => s.title).join(', ');
  throw new Error(`Size "${newType}" not available for ${providerName}/${region}. Available: ${sizeList}`);
}

export async function resizeServer(vmID, newType, options = {}) {
  if (!newType) throw new Error('New server type required (e.g., LARGE-4C-8G)');

  log('info', 'Checking current service configuration...');
  const service = await getServiceDetails(vmID, options.project);
  const providerName = service.provider || service.providerName || options.provider || 'netcup';
  const region = service.datacenter || options.region || 'nbg';
  const currentType = service.serverType || 'unknown';

  const validatedType = await validateSizeForProvider(newType, providerName, region, currentType);

  if (currentType === validatedType) {
    log('warn', `Service is already ${validatedType}`);
    return;
  }

  if (isDowngrade(currentType, validatedType)) {
    if (!DOWNGRADE_SUPPORTED_PROVIDERS.includes(providerName.toLowerCase())) {
      throw new Error(`Downgrade not supported on ${providerName}. Supported: ${DOWNGRADE_SUPPORTED_PROVIDERS.join(', ')}`);
    }
    log('warn', `Downgrade detected (${currentType} -> ${validatedType})`);
  }

  log('info', `Resizing VM ${vmID}: ${currentType} -> ${validatedType}...`);
  const result = await doAction(vmID, 'changeType', {
    newType: validatedType, region, providerName, upgradeCPURAMOnly: options.cpuRamOnly !== false
  });

  log('success', `VM ${vmID} resize initiated`);
  return result;
}
