import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];

vi.mock('../src/api.js', () => ({
  apiRequest: vi.fn(async (endpoint, _method, body) => {
    calls.push({ endpoint, body });
    switch (endpoint) {
      case '/api/cicd/getCICDServices':
        return { status: 'OK', data: { services: [{ id: 5001, providerServerID: '1001', displayName: 'target' }] } };
      case '/api/cicd/getCICDUserAuthAccount':
        return { status: 'OK', data: { GITHUB: [{ name: 'acme', value: 9, type: 'GITHUB' }] } };
      case '/api/cicd/getGitContent':
        return body.file === 'elestio'
          ? { config: { runTime: 'dockerCompose' }, environments: [{ key: 'A', value: 'b' }], ports: [] }
          : { status: 'OK', data: { dockerCompose: 'services:\n  app:\n    image: nginx\n' } };
      case '/api/cicd/createRepoByTemplate':
        return { status: 'OK', id: 42 };
      default:
        return { status: 'OK' };
    }
  }),
  apiRequestNoAuth: vi.fn(async () => ({ instances: [{ id: 66, title: 'Vaultwarden', category: 'Security' }] }))
}));

vi.mock('../src/config.js', () => ({
  loadConfig: () => ({ defaultProject: '79753', email: 'me@example.com' }),
  saveConfig: () => {}
}));

const { deployTemplate } = await import('../src/commands/cicd-template.js');

describe('cicd deploy-template --dry-run', () => {
  beforeEach(() => { calls.length = 0; });

  const endpoints = () => calls.map(c => c.endpoint);

  // A dry run must create nothing. The git route built its repo before the
  // dry-run check, so simulating it would have created a repo in the user's
  // GitHub account.
  it('does not create the template repo on the git route', async () => {
    await deployTemplate('vaultwarden', { target: '1001', project: '79753', owner: 'acme', git: true, dryRun: true, json: true });
    expect(endpoints()).not.toContain('/api/cicd/createRepoByTemplate');
    expect(endpoints()).not.toContain('/api/cicd/createCiCdExistServer');
  });

  it('creates no pipeline on the compose route', async () => {
    await deployTemplate('vaultwarden', { target: '1001', project: '79753', dryRun: true, json: true });
    expect(endpoints()).not.toContain('/api/cicd/createCiCdExistServer');
  });

  it('still creates the repo and the pipeline for a real git deploy', async () => {
    await deployTemplate('vaultwarden', { target: '1001', project: '79753', owner: 'acme', git: true, json: true });
    expect(endpoints()).toContain('/api/cicd/createRepoByTemplate');
    expect(endpoints()).toContain('/api/cicd/createCiCdExistServer');
  });
});
