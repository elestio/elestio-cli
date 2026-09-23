import { describe, it, expect } from 'vitest';
import {
  selectClusterNodes, buildFailoverPayload, parseToggle, clusterDeletionTarget,
  resyncCluster, promoteNode, deleteCluster,
  buildAddNodePayload, addNodeBlocker, planRemoveNode, removeClusterNode, nodeVersion, clusterConfiguration,
  setPortTargets, parseIpList
} from '../src/commands/clusters.js';
import { deleteService } from '../src/commands/services.js';

// Shapes taken from a live 2-node PostgreSQL cluster (cluster 65819)
const cluster = { id: 65819, primaryServerID: '548816', primaryProviderServerID: '947349' };
const primary = { id: 548816, vmID: 947349, clusterID: null, serviceType: 'Cluster' };
const replica = { id: 548817, vmID: 947350, clusterID: 548816, serviceType: 'ClusterNodes' };
const other = { id: 1, vmID: 111, clusterID: null, serviceType: 'Service' };
const otherReplica = { id: 2, vmID: 222, clusterID: 999, serviceType: 'ClusterNodes' };

describe('selectClusterNodes', () => {
  // Replicas point at the primary's serverID, not at the cluster ID: looking
  // nodes up by 65819 returned nothing.
  it('finds the primary and replicas through the primary serverID', () => {
    const nodes = selectClusterNodes([other, replica, primary, otherReplica], cluster);
    expect(nodes.map(n => n.vmID)).toEqual([947349, 947350]);
  });

  it('lists the primary first', () => {
    expect(selectClusterNodes([replica, primary], cluster)[0].vmID).toBe(947349);
  });

  it('falls back to the primary vmID when primaryServerID is missing', () => {
    const nodes = selectClusterNodes([replica, primary], { ...cluster, primaryServerID: null });
    expect(nodes.map(n => n.vmID)).toEqual([947349, 947350]);
  });

  it('returns nothing when the primary is not in the project', () => {
    expect(selectClusterNodes([other], cluster)).toEqual([]);
  });
});

describe('buildFailoverPayload', () => {
  // The API flips isFailoverEnabled to !currentStatus, so the desired state is
  // expressed by sending its opposite. Omitting currentStatus always enabled it.
  it('sends the current state as the opposite of the one wanted', () => {
    expect(buildFailoverPayload(65819, true)).toEqual({ clusterID: '65819', action: 'handleFailover', currentStatus: 0 });
    expect(buildFailoverPayload(65819, false)).toEqual({ clusterID: '65819', action: 'handleFailover', currentStatus: 1 });
  });
});

describe('parseToggle', () => {
  it.each([['on', true], ['enable', true], ['true', true], ['off', false], ['disable', false], ['false', false]])(
    '%s -> %s', (input, expected) => expect(parseToggle(input)).toBe(expected)
  );

  it('rejects anything else', () => {
    expect(() => parseToggle(undefined)).toThrow(/on\|off/);
    expect(() => parseToggle('--force')).toThrow(/on\|off/);
  });
});

describe('clusterDeletionTarget', () => {
  it('deletes through the current primary, which takes every node with it', () => {
    expect(clusterDeletionTarget({ id: 65819, primaryProviderServerID: '947350', isProtected: 0 })).toBe('947350');
  });

  it('refuses a locked cluster and says how to unlock it', () => {
    expect(() => clusterDeletionTarget({ id: 65819, primaryProviderServerID: '947350', isProtected: 1 }))
      .toThrow(/elestio clusters unlock 65819/);
  });

  it('refuses when the primary is unknown', () => {
    expect(() => clusterDeletionTarget({ id: 65819, primaryProviderServerID: null, isProtected: 0 }))
      .toThrow(/primary/);
  });
});

// The guards run before any request, so these never reach the network.
describe('destructive commands require --force', () => {
  it.each([
    ['clusters resync', () => resyncCluster(65819, '79753', false), /erases all data/],
    ['clusters promote', () => promoteNode(65819, 947350, '79753', false), /--force/],
    ['clusters delete', () => deleteCluster(65819, '79753', false), /every node/],
    ['delete-service', () => deleteService(947350, { project: '79753' }), /--force/]
  ])('%s refuses without --force', async (_, run, message) => {
    await expect(run()).rejects.toThrow(message);
  });
});

// Mirrors the dashboard: a new node is createServer with serviceType
// "ClusterNodes" and the primary's serverID; removing one is deleteServer on
// the node, then updateClusterNodes to decrement the cluster.
describe('add node', () => {
  const info = { id: 65819, templateID: 11, replicationMode: 'replica', primaryServerID: '548816', primaryProviderServerID: '947349', status: 'running', nbNodes: 2 };
  const primary = { id: 548816, vmID: 947349, displayName: 'pg-cluster-test1', serverType: 'MEDIUM-2C-4G', datacenter: 'nbg', provider: 'netcup', selected_software_tag: '18', status: 'running', remoteBackupsActivated: 1 };
  const replica = { ...primary, id: 548817, vmID: 947350, displayName: 'pg-cluster-test2', clusterID: 548816 };

  it('copies the primary and numbers the node after the highest one', () => {
    const payload = buildAddNodePayload({ info, primary, nodes: [primary, replica], adminEmail: 'me@example.com', projectId: '79753' });
    expect(payload).toMatchObject({
      templateID: '11', serviceType: 'ClusterNodes', primaryServerID: '548816', isReplica: true,
      serverType: 'MEDIUM-2C-4G', datacenter: 'nbg', providerName: 'netcup', version: '18',
      serverName: 'pg-cluster-test3', projectId: '79753', adminEmail: 'me@example.com', support: 'level1'
    });
  });

  it('keeps numbering unique after a node was removed', () => {
    const third = { ...replica, vmID: 3, displayName: 'pg-cluster-test3' };
    expect(buildAddNodePayload({ info, primary, nodes: [primary, third], adminEmail: 'a@b.c' }).serverName).toBe('pg-cluster-test4');
  });

  // getServices has no version; a node defaulting to "latest" could run
  // another major version than the primary.
  it('uses the primary version and refuses to guess', () => {
    expect(nodeVersion({ selected_software_tag: '18' })).toBe('18');
    expect(nodeVersion({}, '17')).toBe('17');
    expect(() => nodeVersion({})).toThrow(/--version/);
  });

  it('accepts a different size or region', () => {
    const payload = buildAddNodePayload({ info, primary, nodes: [primary], adminEmail: 'a@b.c', size: 'LARGE-4C-8G', region: 'mns' });
    expect(payload).toMatchObject({ serverType: 'LARGE-4C-8G', datacenter: 'mns' });
  });

  it('refuses without remote backups, which seed the new node', () => {
    expect(() => addNodeBlocker(info, { ...primary, remoteBackupsActivated: 0 }, [primary]))
      .toThrow(/elestio backups auto-enable 947349/);
  });

  // Observed live: status "running" while the new node was still being configured.
  it('treats a cluster still configuring a node as busy', () => {
    const configuring = { ...info, jsonConfig: '{"configuring":{"ids":[548834]},"type":"add-node"}' };
    expect(clusterConfiguration(configuring)).toBe('add-node');
    expect(() => addNodeBlocker(configuring, primary, [primary])).toThrow(/busy \(add-node\)/);
    expect(clusterConfiguration({ jsonConfig: null })).toBeNull();
    // What it reads once the node is configured
    expect(clusterConfiguration({ jsonConfig: '{"configuring":{"ids":[]},"type":""}' })).toBeNull();
  });

  it('refuses multi-master clusters, a busy cluster and the node cap', () => {
    expect(() => addNodeBlocker({ ...info, replicationMode: 'master' }, primary, [primary])).toThrow(/multi-master/);
    expect(() => addNodeBlocker({ ...info, status: 'Configuring replica(s)' }, primary, [primary])).toThrow(/busy/);
    expect(() => addNodeBlocker(info, primary, Array.from({ length: 15 }, () => primary))).toThrow(/15/);
    expect(() => addNodeBlocker(info, primary, [primary, replica])).not.toThrow();
  });
});

describe('remove node', () => {
  const info = { id: 65819, templateID: 11, primaryProviderServerID: '947349', status: 'running', nbNodes: 3 };
  const primary = { vmID: 947349, template: 11, displayName: 'pg1', status: 'running', role: 'primary' };
  const replica = { vmID: 947350, template: 11, displayName: 'pg2', labelName: 'pg2-label', status: 'running' };
  const nodes = [primary, replica];

  it('returns the replica to delete and the cluster update', () => {
    expect(planRemoveNode(info, nodes, '947350', '79753')).toEqual({
      node: replica,
      update: { projectId: '79753', clusterId: '65819', templateID: '11', vmID: '947350', labelName: 'pg2-label', appid: 'CloudVM' }
    });
  });

  it('refuses the primary and points at clusters delete', () => {
    expect(() => planRemoveNode(info, nodes, '947349', '79753')).toThrow(/clusters delete/);
  });

  it('refuses an unknown node, a busy node, and Vault below 3 nodes', () => {
    expect(() => planRemoveNode(info, nodes, '1', '79753')).toThrow(/not a node/);
    expect(() => planRemoveNode(info, [primary, { ...replica, status: 'deploying' }], '947350', '79753')).toThrow(/busy/);
    expect(() => planRemoveNode({ ...info, templateID: 183 }, nodes, '947350', '79753')).toThrow(/Vault/);
  });

  it('refuses without --force', async () => {
    await expect(removeClusterNode(65819, 947350, '79753', false)).rejects.toThrow(/--force/);
  });
});

// The dashboard restricts a port on every node (DoActionOnServer updateFirewall
// with primaryServerID + currentPort, so the backend keeps the other nodes'
// IPs allowed), then saves the rules on the cluster row.
describe('cluster firewall', () => {
  const rules = [
    { type: 'INPUT', port: '22', protocol: 'tcp', targets: ['0.0.0.0/0', '::/0'] },
    { type: 'INPUT', port: '25432', protocol: 'tcp', targets: ['0.0.0.0/0', '::/0'] }
  ];

  it('restricts one port to the given IPs, normalised to CIDR, without touching the others', () => {
    const next = setPortTargets(rules, ['25432'], ['203.0.113.7', '198.51.100.0/24']);
    expect(next[1].targets).toEqual(['203.0.113.7/32', '198.51.100.0/24']);
    expect(next[0].targets).toEqual(['0.0.0.0/0', '::/0']);
    expect(rules[1].targets).toEqual(['0.0.0.0/0', '::/0']);
  });

  it('reopens a port to everyone', () => {
    const closed = setPortTargets(rules, ['25432'], ['203.0.113.7']);
    expect(setPortTargets(closed, ['25432'], [])[1].targets).toEqual(['0.0.0.0/0', '::/0']);
  });

  it('rejects an unknown port and invalid addresses', () => {
    expect(() => setPortTargets(rules, ['5432'], ['203.0.113.7'])).toThrow(/Port 5432 has no rule.*22, 25432/);
    expect(() => setPortTargets(rules, ['25432'], ['not-an-ip'])).toThrow(/not-an-ip/);
  });

  it('parses the IP list the CLI receives', () => {
    expect(parseIpList('203.0.113.7, 198.51.100.0/24 ,')).toEqual(['203.0.113.7', '198.51.100.0/24']);
  });
});
