import { describe, it, expect } from 'vitest';
import { parseVmIDs, deploymentProgress } from '../src/deployment.js';

const svc = (vmID, deploymentStatus = 'Deployed', status = 'running') =>
  ({ vmID, providerServerID: `p${vmID}`, deploymentStatus, status });

describe('parseVmIDs', () => {
  it('keeps a single ID as a one-element list', () => {
    expect(parseVmIDs(947278)).toEqual(['947278']);
    expect(parseVmIDs('947278')).toEqual(['947278']);
  });

  // createServer answers a cluster with every node in one string
  it('splits the comma-separated IDs createServer returns for a cluster', () => {
    expect(parseVmIDs('947349,947350')).toEqual(['947349', '947350']);
    expect(parseVmIDs(' 947349 , 947350 ,')).toEqual(['947349', '947350']);
  });

  it('accepts an array', () => {
    expect(parseVmIDs([947349, '947350'])).toEqual(['947349', '947350']);
  });

  it('returns nothing for an empty value', () => {
    expect(parseVmIDs(undefined)).toEqual([]);
    expect(parseVmIDs('')).toEqual([]);
  });
});

describe('deploymentProgress', () => {
  it('is done when the single service is deployed and running', () => {
    const p = deploymentProgress([svc(1)], ['1']);
    expect(p.done).toBe(true);
    expect(p.services).toHaveLength(1);
  });

  it('matches on providerServerID too', () => {
    expect(deploymentProgress([svc(1)], ['p1']).done).toBe(true);
  });

  it('is done for a cluster only when every node is ready', () => {
    const ids = ['947349', '947350'];
    expect(deploymentProgress([svc(947349), svc(947350)], ids).done).toBe(true);
    expect(deploymentProgress([svc(947349), svc(947350, 'Deploying')], ids).done).toBe(false);
    expect(deploymentProgress([svc(947349, 'Deployed', 'stopped'), svc(947350)], ids).done).toBe(false);
  });

  it('is not done while a node has not appeared yet', () => {
    const p = deploymentProgress([svc(947349)], ['947349', '947350']);
    expect(p.done).toBe(false);
    expect(p.missing).toEqual(['947350']);
  });

  it('summarises statuses per node for progress output', () => {
    const p = deploymentProgress([svc(947349), svc(947350, 'Deploying')], ['947349', '947350']);
    expect(p.summary).toBe('947349: Deployed, 947350: Deploying');
  });

  it('is never done with no IDs', () => {
    expect(deploymentProgress([svc(1)], []).done).toBe(false);
  });
});
