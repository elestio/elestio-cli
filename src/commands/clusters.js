import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, formatTable, outputJson, formatPrice } from '../utils.js';
import {
  CLUSTER_TEMPLATE_IDS, CLUSTER_MAX_NODES,
  minClusterNodes, supportsClustering, supportsMultiMaster
} from '../constants.js';
import { getTemplates } from './templates.js';
import { doAction } from './actions.js';
import { listServicesRaw, deleteService, getServiceDetails } from './services.js';

const APPID = 'CloudVM';

function requireProject(projectId) {
  const pid = projectId || loadConfig().defaultProject;
  if (!pid) {
    throw new Error('Project ID required. Use --project or set a default with: elestio config --set-default-project <id>');
  }
  return String(pid);
}

// ── Read ──

export async function listClustersRaw(projectId = null, includeDeleted = false) {
  const response = await apiRequest('/api/clusters/getClusters', 'POST', {
    appid: APPID,
    projectId: requireProject(projectId),
    isActiveCluster: !includeDeleted
  });

  if (response.status === 'KO') throw new Error(response.message || 'Failed to list clusters');
  return response.clusters || [];
}

export async function listClusters(projectId = null, json = false) {
  const clusters = await listClustersRaw(projectId);

  if (json) { outputJson(clusters); return clusters; }
  if (clusters.length === 0) {
    log('info', 'No clusters in this project. Create one with: elestio deploy <template> --cluster');
    return [];
  }

  const rows = clusters.map(c => ({
    id: c.id,
    templateName: c.templateName || 'N/A',
    mode: c.replicationMode || 'N/A',
    nodes: `${c.totalNodes ?? c.nbNodes ?? '?'}`,
    status: c.status || 'N/A',
    cname: c.cname || 'pending',
    cost: c.totalCost ? formatPrice(c.totalCost) : 'N/A'
  }));

  console.log(`\n${colors.bold}Clusters (${clusters.length})${colors.reset}\n`);
  console.log(formatTable(rows, [
    { key: 'id', label: 'ID' },
    { key: 'templateName', label: 'Software' },
    { key: 'mode', label: 'Mode' },
    { key: 'nodes', label: 'Nodes' },
    { key: 'status', label: 'Status' },
    { key: 'cname', label: 'CNAME' },
    { key: 'cost', label: 'Cost' }
  ]));
  console.log('');
  return clusters;
}

/**
 * The API keys cluster lookups on the primary node's provider server ID, not
 * on the cluster ID, so resolve one from the other.
 */
export async function getClusterInfo(clusterId, projectId = null) {
  const clusters = await listClustersRaw(projectId);
  const cluster = clusters.find(c => String(c.id) === String(clusterId));
  if (!cluster) throw new Error(`Cluster ${clusterId} not found in this project`);

  const response = await apiRequest('/api/clusters/getClusterInfos', 'POST', {
    appid: APPID,
    projectId: requireProject(projectId),
    serviceId: String(cluster.primaryProviderServerID)
  });

  if (response.status === 'KO') throw new Error(response.message || 'Failed to get cluster info');
  return { ...cluster, ...(response.clusters || {}) };
}

export async function showCluster(clusterId, projectId = null, json = false) {
  const info = await getClusterInfo(clusterId, projectId);
  const nodes = await listNodesRaw(info, projectId);

  if (json) { outputJson({ ...info, nodes }); return info; }

  console.log(`\n${colors.bold}Cluster ${info.id} - ${info.templateName || 'N/A'}${colors.reset}\n`);
  console.log(`  Status:      ${info.status || 'N/A'} (${info.deploymentStatus || 'N/A'})`);
  console.log(`  Mode:        ${info.replicationMode || 'N/A'}`);
  console.log(`  Nodes:       ${info.totalNodes ?? info.nbNodes ?? nodes.length}`);
  console.log(`  CNAME:       ${info.cname || 'pending'}`);
  console.log(`  Primary:     vmID ${info.primaryProviderServerID || 'N/A'}`);
  console.log(`  Provider:    ${info.provider || 'N/A'} / ${info.datacenter || 'N/A'}`);
  console.log(`  Firewall:    ${info.isFirewallActivated ? 'enabled' : 'disabled'}`);
  console.log(`  Protected:   ${info.isProtected ? 'yes' : 'no'}`);
  console.log(`  Failover:    ${info.isFailoverEnabled ? 'automatic' : 'manual only'}`);
  if (info.totalCost) console.log(`  Cost:        ${formatPrice(info.totalCost)}`);

  if (nodes.length > 0) {
    console.log(`\n${colors.bold}Nodes${colors.reset}\n`);
    console.log(formatTable(nodeRows(nodes, info), NODE_COLUMNS));
  }
  console.log('');
  return info;
}

/**
 * Replicas carry the primary's serverID in their clusterID field, not the
 * cluster's own ID. getActivesNodesByClusterID works the same way and only
 * returns providerServerIDs, while promote needs the full node record, so the
 * nodes are picked out of the project's services instead.
 */
export function selectClusterNodes(services, cluster) {
  const primary = services.find(s =>
    (cluster.primaryServerID && String(s.id) === String(cluster.primaryServerID)) ||
    String(s.vmID) === String(cluster.primaryProviderServerID)
  );
  if (!primary) return [];

  const replicas = services.filter(s => s !== primary && String(s.clusterID) === String(primary.id));
  return [primary, ...replicas];
}

export async function listNodesRaw(cluster, projectId = null) {
  const services = await listServicesRaw(requireProject(projectId));
  return selectClusterNodes(services, cluster);
}

const NODE_COLUMNS = [
  { key: 'role', label: 'Role' },
  { key: 'vmID', label: 'vmID' },
  { key: 'displayName', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'ipv4', label: 'IP' },
  { key: 'datacenter', label: 'Region' }
];

function nodeRows(nodes, info) {
  const primaryVmId = info ? String(info.primaryProviderServerID) : null;
  return nodes.map(n => ({
    role: String(n.vmID) === primaryVmId ? 'primary' : 'replica',
    vmID: n.vmID ?? 'N/A',
    displayName: n.displayName || n.serverName || 'N/A',
    status: n.status || 'N/A',
    ipv4: n.ipv4 || 'pending',
    datacenter: n.datacenter || 'N/A'
  }));
}

export async function listNodes(clusterId, projectId = null, json = false) {
  const info = await getClusterInfo(clusterId, projectId);
  const nodes = await listNodesRaw(info, projectId);

  if (json) { outputJson(nodes); return nodes; }
  if (nodes.length === 0) { log('info', `No active nodes on cluster ${clusterId}`); return []; }

  console.log(`\n${colors.bold}Nodes of cluster ${clusterId}${colors.reset}\n`);
  console.log(formatTable(nodeRows(nodes, info), NODE_COLUMNS));
  console.log('');
  return nodes;
}

// ── Actions ──

async function doActionOnCluster(clusterId, action) {
  const response = await apiRequest('/api/clusters/DoActionOnCluster', 'POST', {
    clusterID: String(clusterId),
    action
  });

  if (response.status === 'KO') throw new Error(response.message || `Action "${action}" failed`);
  return response;
}

export async function lockCluster(clusterId) {
  const result = await doActionOnCluster(clusterId, 'lock');
  log('success', `Cluster ${clusterId} locked (termination protection enabled)`);
  return result;
}

export async function unlockCluster(clusterId) {
  const result = await doActionOnCluster(clusterId, 'unlock');
  log('success', `Cluster ${clusterId} unlocked`);
  return result;
}

const TOGGLES = { on: true, enable: true, true: true, off: false, disable: false, false: false };

export function parseToggle(value) {
  const key = String(value ?? '').toLowerCase();
  if (!(key in TOGGLES)) throw new Error('Expected on|off');
  return TOGGLES[key];
}

/**
 * handleFailover does not fail over: it is the dashboard's automatic-failover
 * switch, and it sets isFailoverEnabled to !currentStatus. The wanted state is
 * therefore sent as its opposite.
 */
export function buildFailoverPayload(clusterId, enabled) {
  return { clusterID: String(clusterId), action: 'handleFailover', currentStatus: enabled ? 0 : 1 };
}

export async function setAutoFailover(clusterId, state) {
  const enabled = parseToggle(state);
  const response = await apiRequest('/api/clusters/DoActionOnCluster', 'POST', buildFailoverPayload(clusterId, enabled));

  if (response.status === 'KO') throw new Error(response.message || 'Failed to update automatic failover');
  log('success', `Automatic failover ${enabled ? 'enabled' : 'disabled'} on cluster ${clusterId}`);
  return response;
}

export async function resyncCluster(clusterId, projectId, force) {
  if (!force) {
    throw new Error('Re-sync erases all data on the replicas and replaces it with a copy of the primary. Re-run with --force.');
  }

  const response = await apiRequest('/api/clusters/resyncCluster', 'POST', {
    appid: APPID,
    projectId: requireProject(projectId),
    clusterID: String(clusterId),
    type: 'resync'
  });

  if (response.status === 'KO') throw new Error(response.message || 'Re-sync failed');
  log('success', `Re-sync requested on cluster ${clusterId}. You will be emailed when it completes.`);
  return response;
}

/**
 * Promoting a replica needs the whole node record plus the cluster's CNAME, so
 * both are resolved here rather than asked of the caller.
 */
export async function promoteNode(clusterId, vmID, projectId, force) {
  if (!force) {
    throw new Error(`Promoting vmID ${vmID} demotes the current primary. Re-run with --force.`);
  }

  const pid = requireProject(projectId);
  const info = await getClusterInfo(clusterId, pid);
  const nodes = await listNodesRaw(info, pid);

  const node = nodes.find(n => String(n.vmID) === String(vmID));
  if (!node) {
    const available = nodes.map(n => n.vmID).join(', ') || 'none';
    throw new Error(`vmID ${vmID} is not an active node of cluster ${clusterId}. Active nodes: ${available}`);
  }
  if (String(node.vmID) === String(info.primaryProviderServerID)) {
    throw new Error(`vmID ${vmID} is already the primary of cluster ${clusterId}`);
  }

  const response = await apiRequest('/api/clusters/promoteNode', 'POST', {
    appid: APPID,
    projectId: pid,
    serviceId: String(info.primaryProviderServerID),
    clusterId: String(clusterId),
    cname: info.cname,
    currentNode: {
      userID: node.userID,
      id: node.id,
      vmID: node.vmID,
      provider: node.provider,
      datacenter: node.datacenter,
      cname: node.cname,
      clusterID: node.clusterID,
      template: node.template
    }
  });

  if (response.status === 'KO') throw new Error(response.message || 'Promotion failed');
  log('success', `vmID ${vmID} is being promoted to primary of cluster ${clusterId}`);
  return response;
}

// ── Nodes ──
//
// Neither operation has an endpoint of its own. The dashboard adds a node with
// createServer (serviceType "ClusterNodes" + the primary's serverID), and
// removes one with deleteServer on the node followed by updateClusterNodes,
// which only decrements the cluster's node count.

const BUSY_STATUSES = ['deploying', 'deleting', 'creating', 'initializing'];

/**
 * The status reads "running" while a node is still being turned into a
 * replica; the work in progress is only visible in jsonConfig
 * ({"configuring":{"ids":[...]},"type":"add-node"}), as the dashboard reads it.
 */
export function clusterConfiguration(info) {
  try {
    const config = typeof info.jsonConfig === 'string' ? JSON.parse(info.jsonConfig) : info.jsonConfig;
    // Once done it stays as {"configuring":{"ids":[]},"type":""}: only a type
    // or pending IDs mean work in progress.
    if (!config || !config.configuring) return null;
    if (config.type) return config.type;
    return Array.isArray(config.configuring.ids) && config.configuring.ids.length > 0 ? 'configuring' : null;
  } catch {
    return null;
  }
}

function isClusterBusy(info) {
  const status = String(info.status || '').toLowerCase();
  return status.includes('configuring') || status.includes('creating') || status === 'being configured' ||
    clusterConfiguration(info) !== null;
}

/** Nodes are named after the cluster: pg-cluster1, pg-cluster2... */
function nextNodeName(nodes, primary) {
  const base = String(primary.displayName || primary.serverName || '').replace(/\d+$/, '');
  const numbers = nodes.map(n => Number((String(n.displayName || '').match(/(\d+)$/) || [])[1] || 0));
  return `${base}${Math.max(nodes.length, ...numbers) + 1}`;
}

export function addNodeBlocker(info, primary, nodes) {
  if (info.replicationMode === 'master') {
    throw new Error('Nodes cannot be added to a multi-master cluster');
  }
  if (isClusterBusy(info) || primary.status !== 'running') {
    throw new Error(`Cluster ${info.id} is busy (${clusterConfiguration(info) || info.status}); wait until it is running`);
  }
  if (!Number(primary.remoteBackupsActivated)) {
    throw new Error(
      'A new node is seeded from the primary\'s remote backup, and remote backups are off. ' +
      `Enable them first: elestio backups auto-enable ${primary.vmID}`
    );
  }
  if (nodes.length >= CLUSTER_MAX_NODES) {
    throw new Error(`Cluster ${info.id} already has ${nodes.length} nodes; the maximum is ${CLUSTER_MAX_NODES}`);
  }
}

/**
 * The node must run the primary's version. getServices does not carry it; the
 * primary's details do, as selected_software_tag. Falling back to "latest"
 * could start a replica on another major version, so a missing one is an error.
 */
export function nodeVersion(primary, override) {
  const version = override || primary.selected_software_tag || primary.version;
  if (!version) throw new Error('Could not read the primary\'s software version; pass it with --version');
  return String(version);
}

export function buildAddNodePayload({ info, primary, nodes, adminEmail, projectId, size, region, provider, version }) {
  return {
    templateID: String(info.templateID),
    serverType: size || primary.serverType,
    datacenter: region || primary.datacenter,
    providerName: provider || primary.provider,
    serverName: nextNodeName(nodes, primary),
    appid: 'CloudVM',
    data: '',
    support: 'level1',
    projectId: projectId === undefined ? undefined : String(projectId),
    version: nodeVersion(primary, version),
    adminEmail,
    deploymentServiceType: 'normal',
    serviceType: 'ClusterNodes',
    isReplica: info.replicationMode === 'replica',
    primaryServerID: String(info.primaryServerID)
  };
}

export async function addClusterNode(clusterId, options = {}) {
  const config = loadConfig();
  const pid = requireProject(options.project);
  const info = await getClusterInfo(clusterId, pid);
  const nodes = await listNodesRaw(info, pid);
  const listed = nodes.find(n => String(n.vmID) === String(info.primaryProviderServerID));
  if (!listed) throw new Error(`Primary of cluster ${clusterId} not found`);
  const primary = { ...listed, ...(await getServiceDetails(listed.vmID, pid)) };

  addNodeBlocker(info, primary, nodes);
  const payload = buildAddNodePayload({
    info, primary, nodes, projectId: pid,
    adminEmail: options.email || config.email,
    size: options.size, region: options.region, provider: options.provider, version: options.version
  });

  if (options.dryRun) {
    if (options.json) { outputJson({ dryRun: true, payload }); return payload; }
    console.log(`\n${colors.bold}Add node (--dry-run)${colors.reset}\n`);
    console.log(`  Cluster:   ${info.id} (${info.templateName || 'N/A'}), ${nodes.length} -> ${nodes.length + 1} nodes`);
    console.log(`  New node:  ${payload.serverName} (${info.replicationMode === 'replica' ? 'replica' : 'node'})`);
    console.log(`  VM:        ${payload.providerName} / ${payload.datacenter} / ${payload.serverType}`);
    console.log(`  Version:   ${payload.version} (same as the primary)`);
    console.log(`  ${colors.yellow}Billed as one more VM.${colors.reset}\n`);
    log('info', 'To add it, run the same command without --dry-run');
    return payload;
  }

  const response = await apiRequest('/api/servers/createServer', 'POST', payload);
  if (!response.providerServerID && !response.action) {
    throw new Error(response.message || 'Failed to add the node');
  }
  log('success', `Node ${payload.serverName} is being added to cluster ${clusterId} (vmID ${response.providerServerID})`);
  log('info', `Follow it with: elestio wait ${response.providerServerID}`);
  return response;
}

export function planRemoveNode(info, nodes, vmID, projectId) {
  const node = nodes.find(n => String(n.vmID) === String(vmID));
  if (!node) {
    throw new Error(`vmID ${vmID} is not a node of cluster ${info.id}. Nodes: ${nodes.map(n => n.vmID).join(', ') || 'none'}`);
  }
  if (String(node.vmID) === String(info.primaryProviderServerID)) {
    throw new Error(`vmID ${vmID} is the primary. Promote a replica first, or delete the whole cluster with: elestio clusters delete ${info.id} --force`);
  }
  if (BUSY_STATUSES.includes(String(node.status).toLowerCase()) || isClusterBusy(info)) {
    throw new Error(`Node ${vmID} or its cluster is busy (${node.status} / ${info.status}); try again once it is running`);
  }
  if (Number(info.templateID) === 183 && nodes.length <= 3) {
    throw new Error('A Vault cluster cannot go below 3 nodes');
  }
  return {
    node,
    update: {
      projectId: String(projectId),
      clusterId: String(info.id),
      templateID: String(node.template ?? info.templateID),
      vmID: String(node.vmID),
      labelName: String(node.labelName || node.displayName || ''),
      appid: 'CloudVM'
    }
  };
}

export async function removeClusterNode(clusterId, vmID, projectId, force) {
  if (!force) {
    throw new Error(`Removing node ${vmID} deletes that VM and its data. Re-run with --force.`);
  }
  const pid = requireProject(projectId);
  const info = await getClusterInfo(clusterId, pid);
  const nodes = await listNodesRaw(info, pid);
  const { update } = planRemoveNode(info, nodes, vmID, pid);

  await deleteService(vmID, { force: true, project: pid });
  const response = await apiRequest('/api/clusters/updateClusterNodes', 'POST', update);
  if (response.status === 'KO') throw new Error(response.message || 'Node deleted, but the cluster node count was not updated');
  log('success', `Node ${vmID} is being removed from cluster ${clusterId}`);
  return response;
}

// ── Firewall ──

const OPEN_TARGETS = ['0.0.0.0/0', '::/0'];
const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}(\/(3[0-2]|[12]?\d))?$/;
const IPV6_CIDR = /^[0-9a-fA-F:]+(\/\d{1,3})?$/;

export function parseIpList(value) {
  return String(value ?? '').split(',').map(ip => ip.trim()).filter(Boolean);
}

function toCidr(ip) {
  if (IPV4_CIDR.test(ip)) return ip.includes('/') ? ip : `${ip}/32`;
  if (ip.includes(':') && IPV6_CIDR.test(ip)) return ip.includes('/') ? ip : `${ip}/128`;
  throw new Error(`"${ip}" is not an IP address or CIDR range`);
}

function parseRules(raw) {
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}

/**
 * Returns new rules where each port in `ports` accepts only `ips` (or everyone
 * when `ips` is empty). The other rules are kept as they are.
 */
export function setPortTargets(rules, ports, ips) {
  const known = rules.map(r => String(r.port));
  for (const port of ports) {
    if (!known.includes(String(port))) {
      throw new Error(`Port ${port} has no rule on this cluster. Ports: ${known.join(', ')}`);
    }
  }
  const targets = ips.length > 0 ? ips.map(toCidr) : OPEN_TARGETS;
  return rules.map(r => ports.map(String).includes(String(r.port)) ? { ...r, targets: [...targets] } : { ...r, targets: [...r.targets] });
}

export async function showClusterFirewall(clusterId, projectId = null, json = false) {
  const info = await getClusterInfo(clusterId, projectId);
  const rules = parseRules(info.firewall_rules);
  if (json) { outputJson(rules); return rules; }

  console.log(`\n${colors.bold}Firewall of cluster ${clusterId}${colors.reset}\n`);
  console.log(formatTable(rules.map(r => ({
    port: r.port, protocol: r.protocol,
    allowed: r.targets.includes('0.0.0.0/0') ? 'everyone' : r.targets.join(', ')
  })), [
    { key: 'port', label: 'Port' },
    { key: 'protocol', label: 'Protocol' },
    { key: 'allowed', label: 'Allowed from' }
  ]));
  console.log('\n  Other nodes of the cluster are always allowed, so replication keeps working.\n');
  return rules;
}

export async function setClusterPortAccess(clusterId, port, ips, projectId = null) {
  const pid = requireProject(projectId);
  const info = await getClusterInfo(clusterId, pid);
  if (isClusterBusy(info)) throw new Error(`Cluster ${clusterId} is busy (${clusterConfiguration(info) || info.status}); try again once it is running`);
  const nodes = await listNodesRaw(info, pid);
  const primary = nodes.find(n => String(n.vmID) === String(info.primaryProviderServerID));
  if (!primary) throw new Error(`Primary of cluster ${clusterId} not found`);

  const ports = [String(port)];
  const rules = JSON.stringify(setPortTargets(parseRules(info.firewall_rules), ports, ips));

  for (const node of nodes) {
    log('info', `Updating firewall on ${node.displayName || node.vmID}...`);
    await doAction(node.vmID, 'updateFirewall', {
      rules, clusterTemplate: info.templateID, primaryServerID: primary.id, currentPort: ports
    });
  }

  const response = await apiRequest('/api/clusters/updateClusterRowFirewall', 'POST', {
    appid: APPID, projectId: pid, clusterID: String(clusterId), firewall_rules: rules
  });
  if (response.status === 'KO') throw new Error(response.message || 'Nodes updated, but the cluster rules were not saved');

  log('success', ips.length > 0
    ? `Port ${port} of cluster ${clusterId} now only accepts ${ips.join(', ')} (plus the cluster's own nodes)`
    : `Port ${port} of cluster ${clusterId} is open to everyone`);
}

/**
 * There is no cluster delete endpoint: deleting the primary service deletes
 * every node with it. The primary changes after a promote, so it is looked up
 * rather than asked of the caller.
 */
export function clusterDeletionTarget(info) {
  if (info.isProtected) {
    throw new Error(`Cluster ${info.id} is locked. Unlock it first with: elestio clusters unlock ${info.id}`);
  }
  if (!info.primaryProviderServerID) throw new Error(`Cluster ${info.id} has no known primary node`);
  return String(info.primaryProviderServerID);
}

export async function deleteCluster(clusterId, projectId, force) {
  if (!force) {
    throw new Error(`Deleting cluster ${clusterId} deletes every node and its data. Re-run with --force.`);
  }

  const pid = requireProject(projectId);
  const info = await getClusterInfo(clusterId, pid);
  const vmID = clusterDeletionTarget(info);
  const nodes = await listNodesRaw(info, pid);

  await deleteService(vmID, { force: true, project: pid });
  log('success', `Cluster ${clusterId} deletion initiated (${nodes.length || info.nbNodes} nodes)`);
}

// ── Catalog ──

export async function listClusterTemplates(json = false) {
  const templates = await getTemplates();

  // The catalog's own isCluster flag is authoritative and stays current; the
  // constant is only a fallback for when the catalog cannot be reached.
  const clusterable = templates.filter(t => supportsClustering(t));
  const rows = (clusterable.length > 0 ? clusterable : CLUSTER_TEMPLATE_IDS.map(id => ({ id, title: `(unlisted #${id})`, category: 'N/A' })))
    .map(t => ({
      id: t.id,
      title: t.title,
      category: t.category || 'N/A',
      minNodes: minClusterNodes(t.id),
      modes: supportsMultiMaster(t.id) ? 'primary-replica, multi-master' : 'primary-replica'
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (json) { outputJson(rows); return rows; }

  console.log(`\n${colors.bold}Templates that support clustering (${rows.length})${colors.reset}\n`);
  console.log(formatTable(rows, [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Software' },
    { key: 'category', label: 'Category' },
    { key: 'minNodes', label: 'Min nodes' },
    { key: 'modes', label: 'Modes' }
  ]));
  console.log(`\n  Max nodes: ${CLUSTER_MAX_NODES}. Deploy with: ${colors.cyan}elestio deploy <software> --cluster --nodes <n>${colors.reset}\n`);
  return rows;
}
