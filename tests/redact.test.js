import { describe, it, expect, vi, afterEach } from 'vitest';
import { redactSecrets, outputJson, setShowSecrets, REDACTED } from '../src/utils.js';

const service = {
  id: 1, displayName: 'srv', token: 'SERVER-TOKEN', s3Credentials: '{"secretKey":"S3"}',
  nested: [{ envVars: '"API_KEY=abc"', deployPrivateKey: 'KEY', webhookSecret: 'HOOK', name: 'p' }]
};

describe('redactSecrets', () => {
  it('masks secret fields at any depth and keeps everything else', () => {
    const out = redactSecrets(service);
    expect(out).toMatchObject({ id: 1, displayName: 'srv', token: REDACTED, s3Credentials: REDACTED });
    expect(out.nested[0]).toEqual({ envVars: REDACTED, deployPrivateKey: REDACTED, webhookSecret: REDACTED, name: 'p' });
    expect(JSON.stringify(out)).not.toMatch(/SERVER-TOKEN|S3|API_KEY|HOOK/);
  });
  it('does not touch the original object', () => {
    redactSecrets(service);
    expect(service.token).toBe('SERVER-TOKEN');
  });
  it('leaves empty secret fields as they are, so "not set" stays visible', () => {
    expect(redactSecrets({ token: null, envVars: '""', s3Credentials: '' })).toEqual({ token: null, envVars: '""', s3Credentials: '' });
  });
  it('keeps an explicit credential answer readable', () => {
    expect(redactSecrets({ url: 'https://x', user: 'root', password: 'p4ss' })).toEqual({ url: 'https://x', user: 'root', password: 'p4ss' });
  });
});

describe('outputJson', () => {
  afterEach(() => { setShowSecrets(false); vi.restoreAllMocks(); });
  const printed = (data) => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    outputJson(data);
    return spy.mock.calls[0][0];
  };
  it('masks secrets by default', () => {
    expect(printed(service)).not.toContain('SERVER-TOKEN');
  });
  it('prints them with --show-secrets', () => {
    setShowSecrets(true);
    expect(printed(service)).toContain('SERVER-TOKEN');
  });
});
