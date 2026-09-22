import { describe, it, expect } from 'vitest';
import {
  normalizeElestioConfig, environmentsToVariables, substitute,
  generateAppPassword, generateShortPassword, createSubstitutions
} from '../src/templates/elestio-config.js';

const subs = { password: 'PWD-abc-123', shortPassword: 'SHORT-42', email: 'dev@example.com' };

// Taken verbatim from elestio-templates/rybbit/elestio.yml
const RYBBIT = {
  config: { runTime: 'dockerCompose', version: '' },
  environments: [
    { key: 'SOFTWARE_VERSION_TAG', value: 'latest' },
    { key: 'ADMIN_EMAIL', value: '[EMAIL]' },
    { key: 'ADMIN_PASSWORD', value: 'random_password' },
    { key: 'DOMAIN', value: '[CI_CD_DOMAIN]' },
    { key: 'CLICKHOUSE_PASSWORD', value: 'random_password' },
    { key: 'DISABLE_SIGNUP', value: 'false' }
  ],
  ports: [{ protocol: 'https', targetPort: 3002, public: true, path: '/', primary: true }],
  lifeCycleConfig: {
    preInstallCommand: 'cd /opt/app && bash ./scripts/preInstall.sh',
    postInstallCommand: 'cd /opt/app && bash ./scripts/postInstall.sh'
  },
  webUI: [{ url: 'https://[CI_CD_DOMAIN]', label: 'Rybbit Analytics', login: '[ADMIN_EMAIL]', password: '[ADMIN_PASSWORD]' }]
};

describe('substitute', () => {
  it('replaces random_password_16 before random_password', () => {
    expect(substitute('a=random_password_16', subs)).toBe('a=SHORT-42');
  });

  it('replaces random_password and [EMAIL]', () => {
    expect(substitute('p=random_password;e=[EMAIL]', subs)).toBe('p=PWD-abc-123;e=dev@example.com');
  });

  it('leaves [CI_CD_DOMAIN] untouched: the CNAME does not exist yet', () => {
    expect(substitute('https://[CI_CD_DOMAIN]', subs)).toBe('https://[CI_CD_DOMAIN]');
  });

  it('passes non-strings through unchanged', () => {
    expect(substitute(3002, subs)).toBe(3002);
    expect(substitute(null, subs)).toBe(null);
  });
});

describe('environmentsToVariables', () => {
  it('produces a newline-separated string, never an array', () => {
    const vars = environmentsToVariables(RYBBIT.environments, subs);
    expect(typeof vars).toBe('string');
    expect(vars.split('\n')).toEqual([
      'SOFTWARE_VERSION_TAG=latest',
      'ADMIN_EMAIL=dev@example.com',
      'ADMIN_PASSWORD=PWD-abc-123',
      'DOMAIN=[CI_CD_DOMAIN]',
      'CLICKHOUSE_PASSWORD=PWD-abc-123',
      'DISABLE_SIGNUP=false'
    ]);
  });

  it('uses the same password everywhere so compose and webUI agree', () => {
    const vars = environmentsToVariables(RYBBIT.environments, subs).split('\n');
    expect(vars[2]).toBe('ADMIN_PASSWORD=PWD-abc-123');
    expect(vars[4]).toBe('CLICKHOUSE_PASSWORD=PWD-abc-123');
  });

  it('returns a string for missing or malformed input', () => {
    expect(environmentsToVariables(undefined, subs)).toBe('');
    expect(environmentsToVariables([], subs)).toBe('');
    expect(environmentsToVariables([{ value: 'orphan' }], subs)).toBe('');
  });

  it('keeps falsy values that are meaningful', () => {
    expect(environmentsToVariables([{ key: 'X', value: 0 }, { key: 'Y', value: false }], subs))
      .toBe('X=0\nY=false');
  });
});

describe('normalizeElestioConfig', () => {
  it('maps buildCommand/runCommand onto the payload field names', () => {
    const cfg = normalizeElestioConfig({
      config: { runTime: 'NodeJs', buildCommand: 'npm run build', runCommand: 'npm start', installCommand: 'npm ci', buildDir: 'dist' }
    }, subs);
    expect(cfg.config.buildCmd).toBe('npm run build');
    expect(cfg.config.runCmd).toBe('npm start');
    expect(cfg.config.installCmd).toBe('npm ci');
  });

  it('prefixes a relative buildDir with a slash', () => {
    const cfg = normalizeElestioConfig({ config: { buildDir: 'dist' } }, subs);
    expect(cfg.config.buildDir).toBe('/dist');
  });

  it('normalises ports and coerces numeric ports to strings', () => {
    const cfg = normalizeElestioConfig(RYBBIT, subs);
    expect(cfg.ports).toHaveLength(1);
    expect(cfg.ports[0]).toMatchObject({
      protocol: 'HTTPS', targetProtocol: 'HTTP', listeningPort: '443',
      targetPort: '3002', targetIP: '172.17.0.1', public: true, path: '/', isAuth: false
    });
  });

  it('fills the ten lifecycle hooks even when the file sets two', () => {
    const cfg = normalizeElestioConfig(RYBBIT, subs);
    expect(Object.keys(cfg.lifeCycleCommand)).toHaveLength(10);
    expect(cfg.lifeCycleCommand.preInstallCommand).toBe('cd /opt/app && bash ./scripts/preInstall.sh');
    expect(cfg.lifeCycleCommand.postBackupCommand).toBe('');
  });

  it('reports hasConfig=false for a repo without elestio.yml', () => {
    expect(normalizeElestioConfig(null, subs).hasConfig).toBe(false);
    expect(normalizeElestioConfig({}, subs).hasConfig).toBe(false);
    expect(normalizeElestioConfig(RYBBIT, subs).hasConfig).toBe(true);
  });

  it('does not mistake the API\'s bare acknowledgement for a config', () => {
    // A repo with no elestio.yml still answers 200 with {"status":"ok"} and
    // nothing else. Reading that as a config is what produces a pipeline that
    // deploys and runs nothing.
    expect(normalizeElestioConfig({ status: 'ok' }, subs).hasConfig).toBe(false);
    expect(normalizeElestioConfig({ status: 'KO' }, subs).hasConfig).toBe(false);
  });

  it('accepts a partial elestio.yml', () => {
    expect(normalizeElestioConfig({ ports: [{ targetPort: 3000 }] }, subs).hasConfig).toBe(true);
    expect(normalizeElestioConfig({ environments: [] }, subs).hasConfig).toBe(true);
  });

  it('keeps [CI_CD_DOMAIN] in webUI so it resolves after deployment', () => {
    const cfg = normalizeElestioConfig(RYBBIT, subs);
    expect(cfg.webUI[0].url).toBe('https://[CI_CD_DOMAIN]');
  });
});

describe('password generators', () => {
  it('generates 8-4-8 passwords mixing case and digits', () => {
    for (let i = 0; i < 40; i++) {
      const p = generateAppPassword();
      expect(p).toMatch(/^[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-[A-Za-z0-9]{8}$/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
    }
  });

  it('generates 8-7 short passwords', () => {
    expect(generateShortPassword()).toMatch(/^[A-Za-z0-9]{8}-[A-Za-z0-9]{7}$/);
  });

  it('createSubstitutions tolerates a missing email', () => {
    expect(createSubstitutions(undefined).email).toBe('');
  });
});
