import { describe, it, expect } from 'vitest';
import { buildPipelinePayload, buildGitPipelinePayload, buildComposePipelinePayload, DEFAULT_COMPOSE } from '../src/payloads/pipeline.js';
import { buildCreateServerPayload, validateClusterOptions, describeCluster } from '../src/payloads/server.js';
import { normalizeElestioConfig } from '../src/templates/elestio-config.js';

const target = {
  displayName: 'cicd-1', id: '99', serverName: 'cicd-1-u1.vm.elestio.app',
  vmID: '848528', vmProvider: 'hetzner', vmRegion: 'fsn', levelName: 'Elestio-services', projectID: '74333'
};
const base = { target, projectId: '74333', pipelineName: 'my-app', cicdMode: 'DockerCompose' };

describe('buildPipelinePayload', () => {
  it('always sends variables as a string', () => {
    expect(buildPipelinePayload({ ...base, variables: [] }).variables).toBe('');
    expect(buildPipelinePayload({ ...base, variables: null }).variables).toBe('');
    expect(buildPipelinePayload({ ...base, variables: 'A=1' }).variables).toBe('A=1');
  });

  it('sends every field the backend reads, including the ones a bare payload omits', () => {
    const p = buildPipelinePayload(base);
    for (const key of ['cluster', 'gitData', 'imageData', 'configData', 'ports', 'variables',
      'isPublicGitRepo', 'exposedPorts', 'gitVolumeConfig', 'isNeedToCreateRepo', 'gitUserFormData',
      'lifeCycleCommand', 'monoRepoWorkSpaces', 'copyCommandConfig', 'CICDMode', 'projectID',
      'pipelineName', 'isMovePipeline', 'authID']) {
      expect(p, `missing ${key}`).toHaveProperty(key);
    }
  });

  it('stringifies projectID and authID', () => {
    const p = buildPipelinePayload({ ...base, projectId: 74333, authID: 5 });
    expect(p.projectID).toBe('74333');
    expect(p.authID).toBe('5');
  });

  it('keeps authID null rather than the string "null"', () => {
    expect(buildPipelinePayload(base).authID).toBe(null);
  });

  it('refuses to build without a target, project or name', () => {
    expect(() => buildPipelinePayload({ ...base, target: null })).toThrow(/target/i);
    expect(() => buildPipelinePayload({ ...base, projectId: null })).toThrow(/project/i);
    expect(() => buildPipelinePayload({ ...base, pipelineName: '' })).toThrow(/name/i);
  });
});

describe('buildGitPipelinePayload', () => {
  const git = {
    target, projectId: '74333', pipelineName: 'my-app', gitType: 'GITHUB',
    repo: 'acme/my-app', branch: 'main', repoID: 12345, authID: '7'
  };

  it('derives repoUrl and cloneUrl from the owner/repo pair', () => {
    const p = buildGitPipelinePayload(git);
    expect(p.gitData.repoUrl).toBe('https://github.com/acme/my-app');
    expect(p.gitData.cloneUrl).toBe('https://github.com/acme/my-app.git');
    expect(p.gitData.repo).toBe('my-app');
    expect(p.CICDMode).toBe('GITHUB');
  });

  it('points at gitlab.com for GITLAB pipelines', () => {
    expect(buildGitPipelinePayload({ ...git, gitType: 'GITLAB' }).gitData.repoUrl)
      .toBe('https://gitlab.com/acme/my-app');
  });

  it('marks createFromTemplate when the repo is generated from a catalog template', () => {
    const p = buildGitPipelinePayload({ ...git, isNeedToCreateRepo: true });
    expect(p.gitData.createFromTemplate).toBe(true);
    expect(p.isNeedToCreateRepo).toBe(true);
  });

  it('prefers elestio.yml over the runtime preset', () => {
    const cfg = normalizeElestioConfig({
      config: { runTime: 'dockerCompose', buildCommand: 'docker compose build', runCommand: 'docker compose up -d' },
      environments: [{ key: 'A', value: '1' }],
      ports: [{ protocol: 'https', targetPort: 8080 }]
    }, { password: 'p', shortPassword: 's', email: 'e' });

    const p = buildGitPipelinePayload({ ...git, elestioConfig: cfg });
    expect(p.configData.runTime).toBe('dockerCompose');
    expect(p.configData.runCmd).toBe('docker compose up -d');
    expect(p.variables).toBe('A=1');
    expect(p.ports[0].targetPort).toBe('8080');
  });

  it('falls back to the preset when the repo has no elestio.yml', () => {
    const p = buildGitPipelinePayload({ ...git, appType: 'node' });
    expect(p.configData.runTime).toBe('NodeJs');
    expect(p.configData.runCmd).toBe('npm start');
    expect(p.variables).toBe('');
  });

  it('lets an explicit flag override elestio.yml', () => {
    const cfg = normalizeElestioConfig({ config: { runCommand: 'from-file' } }, { password: 'p', shortPassword: 's', email: 'e' });
    const p = buildGitPipelinePayload({ ...git, elestioConfig: cfg, overrides: { runCmd: 'from-flag' } });
    expect(p.configData.runCmd).toBe('from-flag');
  });
});

describe('buildComposePipelinePayload', () => {
  it('inlines the compose file and declares DockerCompose mode', () => {
    const p = buildComposePipelinePayload({ target, projectId: '74333', pipelineName: 'x', compose: DEFAULT_COMPOSE });
    expect(p.CICDMode).toBe('DockerCompose');
    expect(p.imageData.compose).toBe(DEFAULT_COMPOSE);
    expect(p.gitData).toEqual({});
    expect(p.authID).toBe(null);
  });

  it('refuses to build without a compose file', () => {
    expect(() => buildComposePipelinePayload({ target, projectId: '1', pipelineName: 'x' })).toThrow(/compose/i);
  });

  it('carries env vars and lifecycle hooks from elestio.yml', () => {
    const cfg = normalizeElestioConfig({
      environments: [{ key: 'ADMIN_PASSWORD', value: 'random_password' }],
      lifeCycleConfig: { postInstallCommand: './scripts/postInstall.sh' }
    }, { password: 'PWD', shortPassword: 's', email: 'e' });

    const p = buildComposePipelinePayload({ target, projectId: '1', pipelineName: 'x', compose: 'services: {}', elestioConfig: cfg });
    expect(p.variables).toBe('ADMIN_PASSWORD=PWD');
    expect(p.lifeCycleCommand.postInstallCommand).toBe('./scripts/postInstall.sh');
  });
});

describe('validateClusterOptions', () => {
  const pg = { id: 11, title: 'PostgreSQL' };
  const mysql = { id: 12, title: 'MySQL' };
  const clickhouse = { id: 93, title: 'ClickHouse' };
  const wordpress = { id: 26, title: 'WordPress' };

  it('rejects templates that cannot be clustered', () => {
    expect(() => validateClusterOptions({ enabled: true }, wordpress)).toThrow(/does not support clustering/);
  });

  it("trusts the catalog's isCluster flag over the built-in list", () => {
    // Jitsu is clusterable in the catalog but absent from the dashboard's
    // hardcoded list, which the built-in constant mirrors.
    expect(validateClusterOptions({}, { id: 178, title: 'Jitsu', isCluster: 1 }).nodes).toBe(2);
    // ...and a template the catalog has since un-flagged is refused even
    // though its ID is still in the constant.
    expect(() => validateClusterOptions({}, { id: 11, title: 'PostgreSQL', isCluster: 0 }))
      .toThrow(/does not support clustering/);
  });

  it('falls back to the built-in list when the catalog omits the flag', () => {
    expect(validateClusterOptions({}, { id: 11, title: 'PostgreSQL' }).nodes).toBe(2);
    expect(() => validateClusterOptions({}, { id: 26, title: 'WordPress' })).toThrow(/does not support clustering/);
  });

  it('defaults to 2 nodes in primary-replica mode', () => {
    expect(validateClusterOptions({}, pg)).toEqual({ nodes: 2, isReplica: true, mode: 'primary-replica' });
  });

  it('defaults to 3 nodes for quorum-based software', () => {
    expect(validateClusterOptions({}, clickhouse).nodes).toBe(3);
  });

  it('enforces the per-template minimum', () => {
    expect(() => validateClusterOptions({ nodes: 2 }, clickhouse)).toThrow(/at least 3 nodes/);
    expect(() => validateClusterOptions({ nodes: 1 }, pg)).toThrow(/at least 2 nodes/);
  });

  it('caps the cluster at 15 nodes', () => {
    expect(() => validateClusterOptions({ nodes: 16 }, pg)).toThrow(/cannot exceed 15/);
    expect(validateClusterOptions({ nodes: 15 }, pg).nodes).toBe(15);
  });

  it('allows multi-master only for MySQL', () => {
    expect(validateClusterOptions({ mode: 'multi-master' }, mysql).isReplica).toBe(false);
    expect(() => validateClusterOptions({ mode: 'multi-master' }, pg)).toThrow(/multi-master/);
  });

  it('rejects an unknown mode and a non-integer node count', () => {
    expect(() => validateClusterOptions({ mode: 'sharded' }, pg)).toThrow(/Unknown cluster mode/);
    expect(() => validateClusterOptions({ nodes: 2.5 }, pg)).toThrow(/whole number/);
    expect(() => validateClusterOptions({ nodes: 'two' }, pg)).toThrow(/whole number/);
  });
});

describe('buildCreateServerPayload', () => {
  const opts = {
    template: { id: 11, title: 'PostgreSQL' }, projectId: 74333, serverName: 'pg-1',
    serverType: 'MEDIUM-2C-4G', datacenter: 'nbg', provider: 'netcup',
    support: 'level1', adminEmail: 'dev@example.com', version: '16', serviceType: 'Service'
  };

  it('omits cluster fields for a single service', () => {
    const p = buildCreateServerPayload(opts);
    expect(p.serviceType).toBe('Service');
    expect(p).not.toHaveProperty('clusterNodes');
    expect(p).not.toHaveProperty('isReplica');
  });

  it('sets the three cluster fields together', () => {
    const cluster = validateClusterOptions({ nodes: 3 }, opts.template);
    const p = buildCreateServerPayload({ ...opts, cluster });
    expect(p.serviceType).toBe('Cluster');
    expect(p.clusterNodes).toBe(3);
    expect(p.isReplica).toBe(true);
  });

  it('adds cicdPayload for a CI/CD target', () => {
    const p = buildCreateServerPayload({ ...opts, serviceType: 'CICD', pipelineName: 'my-pipeline' });
    expect(p.cicdPayload).toEqual({ pipelineName: 'my-pipeline' });
  });

  it('stringifies templateID and projectId', () => {
    const p = buildCreateServerPayload(opts);
    expect(p.templateID).toBe('11');
    expect(p.projectId).toBe('74333');
  });
});

describe('describeCluster', () => {
  it('describes each topology in VM counts', () => {
    expect(describeCluster(null)).toBe('1 node');
    expect(describeCluster({ nodes: 2, isReplica: true })).toBe('1 primary + 1 replica (2 VMs)');
    expect(describeCluster({ nodes: 3, isReplica: true })).toBe('1 primary + 2 replicas (3 VMs)');
    expect(describeCluster({ nodes: 2, isReplica: false })).toBe('2 primaries, multi-master (2 VMs)');
  });
});
