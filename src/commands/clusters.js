import { apiRequest } from '../api.js';
import { loadConfig } from '../config.js';
import { log, colors, formatTable, outputJson, formatPrice } from '../utils.js';
import {
  CLUSTER_TEMPLATE_IDS, CLUSTER_MAX_NODES,
  minClusterNodes, supportsClustering, supportsMultiMaster
} from '../constants.js';
import { getTemplates } from './templates.js';
import { listServicesRaw } from './services.js';

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

export async function failoverCluster(clusterId, force) {
  if (!force) {
    throw new Error('Failover promotes a replica and demotes the current primary. Re-run with --force.');
  }
  const result = await doActionOnCluster(clusterId, 'handleFailover');
  log('success', `Failover initiated on cluster ${clusterId}`);
  return result;
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
