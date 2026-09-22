import { describe, it, expect } from 'vitest';
import { selectClusterNodes } from '../src/commands/clusters.js';

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
