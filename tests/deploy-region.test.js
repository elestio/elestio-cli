import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({
  apiRequest: vi.fn(async () => ({ status: 'OK' })),
  apiRequestNoAuth: vi.fn()
}));
vi.mock('../src/utils.js', async (orig) => ({ ...(await orig()), log: vi.fn(), outputJson: vi.fn() }));
vi.mock('../src/config.js', async (orig) => ({
  ...(await orig()),
  loadConfig: () => ({ defaultProject: '74333', email: 'a@b.c', defaults: { provider: 'netcup', datacenter: 'nbg', serverType: 'MEDIUM-2C-4G', support: 'level1' } })
}));

const { apiRequest, apiRequestNoAuth } = await import('../src/api.js');
const { deployService } = await import('../src/commands/services.js');

const OFFER_ON = new Date() < new Date('2027-01-01T00:00:00Z');

describe('deploy region', () => {
  beforeEach(() => {
    apiRequest.mockClear();
    apiRequestNoAuth.mockImplementation(async (path) => ({
      instances: path.includes('getTemplates')
        ? [{ id: 11, title: 'PostgreSQL', dockerhub_default_tag: '16' }]
        : [{ providerName: 'OVH', regionID: 'DE1', title: 'MEDIUM-2C-4G', pricePerHour: '0.06' }]
    }));
  });

  it('defaults OVH to DE1, never to the netcup region', async () => {
    const preview = await deployService('PostgreSQL', { provider: 'ovh', dryRun: true, json: true });
    expect(preview.datacenter).toBe('DE1');
  });

  it('previews the VM price the customer pays', async () => {
    const preview = await deployService('PostgreSQL', { provider: 'ovh', dryRun: true, json: true });
    expect(Number(preview.vmPricePerHour)).toBeCloseTo(OFFER_ON ? 0.03 : 0.06);
    if (OFFER_ON) expect(preview.launchOffer).toMatch(/50%/);
  });

  it('asks for --region on a provider with no default', async () => {
    await expect(deployService('PostgreSQL', { provider: 'vultr', dryRun: true, json: true })).rejects.toThrow(/--region is required for vultr/);
  });
});
