import {
  CLUSTER_MAX_NODES, CLUSTER_MODES,
  minClusterNodes, supportsClustering, supportsMultiMaster
} from '../constants.js';

/**
 * Builder and validation for POST /api/servers/createServer.
 *
 * Cluster deployments differ from single services by three fields only
 * (serviceType, clusterNodes, isReplica) -- but getting them wrong bills VMs
 * before the API rejects the request, so everything is validated upfront.
 */

/**
 * @param {object} cluster
 * @param {boolean} cluster.enabled
 * @param {string}  cluster.mode   primary-replica | multi-master
 * @param {number}  cluster.nodes  total nodes, primary included
 * @param {object}  template       catalog template, needs at least { id, title }
 * @returns {{nodes: number, isReplica: boolean, mode: string}}
 */
export function validateClusterOptions(cluster, template) {
  const templateId = Number(template.id);

  if (!supportsClustering(template)) {
    throw new Error(
      `"${template.title}" does not support clustering. ` +
      'Run "elestio clusters templates" to list the software that does.'
    );
  }

  const mode = cluster.mode || 'primary-replica';
  if (!CLUSTER_MODES.includes(mode)) {
    throw new Error(`Unknown cluster mode "${mode}". Expected one of: ${CLUSTER_MODES.join(', ')}`);
  }

  if (mode === 'multi-master' && !supportsMultiMaster(templateId)) {
    throw new Error(`"${template.title}" does not support multi-master; use --cluster-mode primary-replica`);
  }

  const min = minClusterNodes(templateId);
  const nodes = cluster.nodes === undefined || cluster.nodes === null ? min : Number(cluster.nodes);

  if (!Number.isInteger(nodes)) {
    throw new Error(`--nodes must be a whole number, got "${cluster.nodes}"`);
  }
  if (nodes < min) {
    throw new Error(
      `"${template.title}" needs at least ${min} nodes` +
      (min === 3 ? ' (quorum-based software requires an odd number of nodes)' : '')
    );
  }
  if (nodes > CLUSTER_MAX_NODES) {
    throw new Error(`A cluster cannot exceed ${CLUSTER_MAX_NODES} nodes, got ${nodes}`);
  }

  return { nodes, isReplica: mode === 'primary-replica', mode };
}

/**
 * @param {object} opts see deployService() for where each value comes from
 */
export function buildCreateServerPayload(opts) {
  const {
    template, projectId, serverName, serverType, datacenter, provider,
    support, adminEmail, version, serviceType, cluster = null,
    pipelineName = null
  } = opts;

  const payload = {
    templateID: String(template.id),
    serverType,
    datacenter,
    providerName: provider,
    serverName,
    appid: 'Cloudxx',
    data: 'data',
    support,
    projectId: String(projectId),
    version,
    adminEmail,
    deploymentServiceType: 'normal',
    serviceType
  };

  if (serviceType === 'CICD') {
    payload.cicdPayload = { pipelineName: pipelineName || serverName };
  }

  if (cluster) {
    payload.serviceType = 'Cluster';
    payload.clusterNodes = cluster.nodes;
    payload.isReplica = cluster.isReplica;
  }

  return payload;
}

/**
 * Human-readable summary of what a cluster deployment will actually create,
 * used by both --dry-run and the confirmation line.
 */
export function describeCluster(cluster) {
  if (!cluster) return '1 node';
  return cluster.isReplica
    ? `1 primary + ${cluster.nodes - 1} replica${cluster.nodes - 1 === 1 ? '' : 's'} (${cluster.nodes} VMs)`
    : `${cluster.nodes} primaries, multi-master (${cluster.nodes} VMs)`;
}
