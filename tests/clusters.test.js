import { describe, it, expect } from 'vitest';
import { selectClusterNodes, buildFailoverPayload, parseToggle, clusterDeletionTarget } from '../src/commands/clusters.js';

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
