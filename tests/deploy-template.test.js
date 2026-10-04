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
          ? {
              config: { runTime: 'dockerCompose' },
              environments: [{ key: 'A', value: 'b' }],
              ports: [],
              lifeCycleConfig: { preInstallCommand: './scripts/preInstall.sh', postInstallCommand: './scripts/postInstall.sh' }
            }
          : { status: 'OK', data: { dockerCompose: 'services:\n  kafka:\n    volumes:\n      - ./jaas/server.conf:/etc/kafka/jaas/server.conf\n' } };
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

describe('routes', () => {
  beforeEach(() => { calls.length = 0; });

  const payloadOf = () => {
    const call = calls.find(c => c.endpoint === '/api/cicd/createCiCdExistServer');
    return call?.body;
  };

  // The dashboard's route: the pipeline points at the elestio-examples repo and
  // Elestio clones it on the VM, so mounted files exist and install scripts run.
  it('defaults to the template-repo route, which keeps the install scripts', async () => {
    await deployTemplate('vaultwarden', { target: '1001', project: '79753', json: true });
    const payload = payloadOf();
    expect(payload.imageData).toMatchObject({
      dockerExample: 'https://github.com/elestio-examples/vaultwarden',
      branch: 'main',
      repoName: 'vaultwarden'
    });
    expect(payload.lifeCycleCommand.preInstallCommand).toBe('./scripts/preInstall.sh');
    expect(payload.imageData.compose).toContain('kafka');
  });

  // Kafka, Chromadb, ClickHouse and half the catalogue mount files from their
  // repo; the inline route cannot and refuses, the default route can.
  it('no longer refuses software that mounts repo files', async () => {
    await expect(deployTemplate('vaultwarden', { target: '1001', project: '79753', json: true })).resolves.toBeTruthy();
    await expect(deployTemplate('vaultwarden', { target: '1001', project: '79753', inlineCompose: true, json: true }))
      .rejects.toThrow(/will not exist on the compose route/);
  });

  it('inlines the compose only when asked, and then drops the hooks', async () => {
    await deployTemplate('vaultwarden', { target: '1001', project: '79753', inlineCompose: true, force: true, json: true });
    const payload = payloadOf();
    // the inline route sends an empty dockerExample, so the backend stores no gitConfig
    expect(payload.imageData.dockerExample).toBeFalsy();
    expect(Object.values(payload.lifeCycleCommand).every(v => v === '')).toBe(true);
  });

  it('reports the route it used', async () => {
    const plan = await deployTemplate('vaultwarden', { target: '1001', project: '79753', dryRun: true, json: true });
    expect(plan.imageData.dockerExample).toBeTruthy();
  });
});
