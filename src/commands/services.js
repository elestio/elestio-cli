import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { findTemplate } from './templates.js';
import { formatTable, formatService, formatPrice, colors, log, sleep, validateServerName, outputJson } from '../utils.js';

async function listProjectsRaw() {
  const response = await apiRequest('/api/projects/getList');
  if (response.status !== 'OK') return [];
  return response.data?.projects || [];
}

export async function findServiceAcrossProjects(vmID) {
  const projects = await listProjectsRaw();
  for (const project of projects) {
    const pid = project.projectID;
    try {
      const services = await listServicesRaw(pid);
      const svc = services.find(s => String(s.vmID) === String(vmID));
      if (svc) return { service: svc, projectId: pid, projectName: project.project_name };
    } catch { /* skip */ }
  }
  return null;
}

export async function listServicesRaw(projectId = null) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required. Use --project or set default with: elestio config --set-default-project <id>');

  const response = await apiRequest('/api/servers/getServices', 'POST', {
    appid: 'Cloudxx',
    projectId: String(pid),
    isActiveService: 'true'
  });

  return response.servers || response.data?.services || [];
}

export async function listServices(projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required. Use --project or set default with: elestio config --set-default-project <id>');

  const response = await apiRequest('/api/servers/getServices', 'POST', {
    appid: 'Cloudxx',
    projectId: String(pid),
    isActiveService: 'true'
  });

  if (response.status === 'KO' || response.code === 'AccessDenied') {
    throw new Error(response.message || 'Access denied.');
  }

  const services = response.servers || response.data?.services || [];

  if (json) {
    outputJson(services);
    return services;
  }

  if (services.length === 0) {
    log('info', `No services in project ${pid}`);
    return [];
  }

  const columns = [
    { key: 'displayName', label: 'Name' },
    { key: 'templateName', label: 'Software' },
    { key: 'status', label: 'Status' },
    { key: 'deploymentStatus', label: 'Deploy' },
    { key: 'vmID', label: 'vmID' },
    { key: 'ipv4', label: 'IP' }
  ];

  console.log(`\n${colors.bold}Services in project ${pid} (${services.length})${colors.reset}\n`);
  console.log(formatTable(services, columns));
  console.log('');
  return services;
}

export async function getServiceDetails(vmID, projectId = null) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;
  if (!pid) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/getServerDetails', 'POST', {
    vmID: String(vmID),
    projectID: String(pid)
  });

  if (response.serviceInfos && response.serviceInfos.length > 0) return response.serviceInfos[0];
  if (response.status === 'OK' && response.data) return response.data;
  if (response.status === 'KO' || response.message) throw new Error(response.message || 'Failed to get service details');
  return null;
}

export async function getServiceByVmId(vmID, projectId = null) {
  const services = await listServicesRaw(projectId);
  return services.find(s => String(s.vmID) === String(vmID));
}

export async function getServerIdFromVmId(vmID, projectId = null) {
  const service = await getServiceByVmId(vmID, projectId);
  if (!service) throw new Error(`Service with vmID ${vmID} not found`);
  return service.id;
}

export async function deployService(templateNameOrId, options = {}) {
  const config = loadConfig();
  const template = await findTemplate(templateNameOrId);
  if (!template) throw new Error(`Template "${templateNameOrId}" not found. Use: elestio templates search <name>`);

  const projectId = options.project || config.defaultProject;
  if (!projectId) throw new Error('Project ID required. Use --project or set default');

  const serverName = options.name || `${template.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`;
  const serverType = options.size || config.defaults?.serverType || 'MEDIUM-2C-4G';
  const datacenter = options.region || config.defaults?.datacenter || 'nbg';
  const support = options.support || config.defaults?.support || 'level1';
  const adminEmail = options.email || config.email;
  const provider = options.provider || config.defaults?.provider || 'netcup';
  const version = options.version || template.dockerhub_default_tag || 'latest';

  const nameValidation = validateServerName(serverName);
  if (!nameValidation.valid) throw new Error(nameValidation.error);

  const isCicd = template.title?.toLowerCase().includes('ci-cd') || templateNameOrId?.toLowerCase() === 'cicd';
  const serviceType = isCicd ? 'CICD' : 'Service';

  if (options.dryRun) {
    const preview = {
      template: template.title, templateId: template.id, version,
      projectId, serverName, provider, datacenter, serverType, support, adminEmail, serviceType
    };

    if (options.json) {
      outputJson({ dryRun: true, ...preview });
      return preview;
    }

    console.log(`\n${colors.bold}Deployment Preview (--dry-run)${colors.reset}\n`);
    console.log(`  Software:   ${colors.cyan}${template.title}${colors.reset} (ID: ${template.id})`);
    console.log(`  Version:    ${version}`);
    console.log(`  Project:    ${projectId}`);
    console.log(`  Name:       ${serverName}`);
    console.log(`  Provider:   ${provider}`);
    console.log(`  Region:     ${datacenter}`);
    console.log(`  Size:       ${serverType}`);
    console.log(`  Support:    ${support}`);
    console.log(`  Admin:      ${adminEmail}`);
    console.log('');
    log('info', 'To deploy, run the same command without --dry-run');
    return preview;
  }

  log('info', `Deploying ${template.title} (ID: ${template.id})`);
  log('info', `  Project: ${projectId} | Name: ${serverName}`);
  log('info', `  Provider: ${provider} | Size: ${serverType} @ ${datacenter}`);

  const payload = {
    templateID: String(template.id), serverType, datacenter,
    providerName: provider, serverName, appid: 'Cloudxx',
    data: 'data', support, projectId: String(projectId),
    version, adminEmail, deploymentServiceType: 'normal', serviceType
  };

  if (isCicd) {
    payload.cicdPayload = { pipelineName: options.pipelineName || serverName };
  }

  const response = await apiRequest('/api/servers/createServer', 'POST', payload);

  if (!response.providerServerID && !response.action) {
    throw new Error(response.message || 'Failed to create service');
  }

  log('success', `Deployment started! Provider Server ID: ${response.providerServerID}`);

  if (options.wait !== false) {
    log('info', 'Waiting for deployment to complete...');
    return await waitForDeployment(response.providerServerID, projectId, options.timeout);
  }

  return response;
}

export async function waitForDeployment(vmID, projectId, timeoutMs = 600000) {
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < timeoutMs) {
    const services = await listServicesRaw(projectId);
    const svc = services.find(s =>
      String(s.vmID) === String(vmID) || String(s.providerServerID) === String(vmID)
    );

    if (!svc) { await sleep(10000); continue; }

    if (svc.deploymentStatus !== lastStatus) {
      lastStatus = svc.deploymentStatus;
      log('info', `Status: ${svc.deploymentStatus}`);
    }

    if (svc.deploymentStatus === 'Deployed' && svc.status === 'running') {
      log('success', 'Deployment complete!');
      console.log('\n' + formatService(svc) + '\n');
      return svc;
    }

    await sleep(15000);
  }

  throw new Error(`Deployment timed out after ${timeoutMs / 1000}s`);
}

export async function deleteService(vmID, options = {}) {
  if (!options.force) throw new Error('Deleting a service requires --force flag');

  const config = loadConfig();
  const projectId = options.project || config.defaultProject;
  if (!projectId) throw new Error('Project ID required');

  const response = await apiRequest('/api/servers/deleteServer', 'POST', {
    vmID: String(vmID),
    projectID: String(projectId),
    isDeleteServiceWithBackup: options.withBackups ? 'true' : 'false'
  });

  if (response.status !== 'OK' && !response.action) {
    throw new Error(response.message || 'Failed to delete service');
  }

  log('success', `Service ${vmID} deletion initiated`);
  return response;
}

export async function moveService(vmIDOrServerID, targetProjectId, sourceProjectId = null) {
  const config = loadConfig();
  const sourcePid = sourceProjectId || config.defaultProject;

  let serverID = vmIDOrServerID;
  let foundInProject = null;

  try {
    const service = await getServiceByVmId(vmIDOrServerID, sourcePid);
    if (service?.id) { serverID = service.id; foundInProject = sourcePid; }
  } catch { /* not found */ }

  if (!foundInProject) {
    log('info', `Searching across all projects...`);
    const found = await findServiceAcrossProjects(vmIDOrServerID);
    if (found) {
      serverID = found.service.id;
      log('info', `Found in project "${found.projectName}" (${found.projectId})`);
    } else {
      throw new Error(`Service ${vmIDOrServerID} not found in any project`);
    }
  }

  const response = await apiRequest('/api/servers/moveService', 'PUT', {
    serviceId: String(serverID),
    projectId: String(targetProjectId)
  });

  if (response.status !== 'OK') throw new Error(response.message || 'Failed to move service');

  log('success', `Service moved to project ${targetProjectId}`);
  return response;
}

export async function showService(vmID, projectId = null, json = false) {
  const config = loadConfig();
  const pid = projectId || config.defaultProject;

  const details = await getServiceDetails(vmID, pid);
  if (!details) throw new Error(`Service with vmID ${vmID} not found`);

  if (json) {
    outputJson(details);
    return details;
  }

  console.log('\n' + formatService(details));
  console.log(`\n${colors.bold}Extended Details${colors.reset}`);
  console.log(`  Server ID: ${details.id || 'N/A'}`);
  console.log(`  Firewall: ${details.isFirewallActivated ? 'enabled' : 'disabled'}`);
  console.log(`  Alerts: ${details.isAlertsActivated ? 'enabled' : 'disabled'}`);
  console.log(`  Remote Backup: ${details.remoteBackupsActivated ? 'enabled' : 'disabled'}`);
  console.log(`  System Auto-Update: ${details.system_AutoUpdate_Enabled ? 'enabled' : 'disabled'}`);
  console.log(`  App Auto-Update: ${details.app_AutoUpdate_Enabled ? 'enabled' : 'disabled'}`);
  console.log(`  Price/Hour: $${details.pricePerHour || 'N/A'}`);
  console.log('');
  return details;
}
