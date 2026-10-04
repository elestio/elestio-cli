import { describe, it, expect } from 'vitest';
import { parseGitAuthId, buildViewLogPayload } from '../src/commands/cicd.js';
import { installHooks, lifecycleWarning } from '../src/commands/cicd-template.js';

describe('parseGitAuthId', () => {
  // getCICDUserAuthAccount answers an object keyed by provider, not an array,
  // so the git route always reported "No GITHUB account connected".
  const response = {
    status: 'OK',
    data: {
      GITHUB: [{ name: 'acme', value: 53, type: 'GITHUB' }],
      GITLAB: [],
      GITLAB_SELF_HOSTED: []
    }
  };

  it('reads the account of the requested provider', () => {
    expect(parseGitAuthId(response, 'GITHUB')).toBe('53');
    expect(parseGitAuthId(response, 'GITLAB')).toBeNull();
  });

  it('still reads the legacy array shape', () => {
    expect(parseGitAuthId({ data: [{ externalProviderName: 'GITHUB', id: 7 }] }, 'GITHUB')).toBe('7');
  });

  it('returns null when nothing is connected', () => {
    expect(parseGitAuthId({ data: {} }, 'GITHUB')).toBeNull();
    expect(parseGitAuthId({}, 'GITHUB')).toBeNull();
  });
});

describe('buildViewLogPayload', () => {
  // The endpoint requires isLatest and spells the file filePath; sending
  // filepath without isLatest was rejected as a missing parameter.
  it('asks for the latest log when no file is given', () => {
    expect(buildViewLogPayload('1001', '42', '79753')).toEqual({
      vmID: '1001', projectID: '79753', pipelineID: 42, isLatest: true
    });
  });

  it('asks for one file by name', () => {
    expect(buildViewLogPayload('1001', '42', '79753', '2026-10-04-09.31.49.026.log')).toEqual({
      vmID: '1001', projectID: '79753', pipelineID: 42, isLatest: false, filePath: '2026-10-04-09.31.49.026.log'
    });
  });

  // pipeline-history gives the bare logID; the file lives in the pipeline's own directory.
  it('keeps only the file name when given a full path', () => {
    expect(buildViewLogPayload('1001', '42', '79753', '/var/log/cicd/chromadb/x.log').filePath).toBe('x.log');
  });
});

describe('install hooks on the compose route', () => {
  const config = (lifecycle = {}) => ({ lifeCycleCommand: { preInstallCommand: '', postInstallCommand: '', preBackupCommand: '', ...lifecycle } });

  // Every catalog template declares these, including vaultwarden, redis and
  // metabase, which were verified to deploy fine on the compose route. So they
  // are reported, not refused; only file mounts refuse.
  it('lists the install hooks and ignores the other lifecycle hooks', () => {
    expect(installHooks(config({ postInstallCommand: './scripts/postInstall.sh', preBackupCommand: './scripts/preBackup.sh' })))
      .toEqual(['postInstallCommand=./scripts/postInstall.sh']);
    expect(installHooks(config())).toEqual([]);
  });

  it('warns about what the skipped scripts may leave undone', () => {
    const warning = lifecycleWarning('chromadb', ['postInstallCommand=./scripts/postInstall.sh']);
    expect(warning).toMatch(/chromadb/);
    expect(warning).toMatch(/admin account, initial data or a sign-up lockdown/);
  });
});
