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
const { outputJson } = await import('../src/utils.js');
const { createVolume, createServiceVolume } = await import('../src/commands/volumes.js');
const { listSizes } = await import('../src/commands/templates.js');

const OFFER_ON = new Date() < new Date('2027-01-01T00:00:00Z');

describe('volumes create on OVH', () => {
  beforeEach(() => apiRequest.mockClear());

  it('sends the normalized type and the backend price', async () => {
    await createVolume({ name: 'data', size: 100, provider: 'ovh', datacenter: 'GRA11', storageType: 'hdd' });
    const body = apiRequest.mock.calls[0][2];
    expect(body.blockStorageType).toBe('HDD');
    expect(Number(body.price)).toBeCloseTo(OFFER_ON ? 7.5 : 15);
  });

  it('refuses HDD in Paris before calling the API', async () => {
    await expect(createVolume({ name: 'data', size: 100, provider: 'ovh', datacenter: 'EU-WEST-PAR', storageType: 'HDD' }))
      .rejects.toThrow(/not available in EU-WEST-PAR/);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('refuses an unknown type', async () => {
    await expect(createVolume({ name: 'data', size: 100, provider: 'ovh', datacenter: 'DE1', storageType: 'ssd' }))
      .rejects.toThrow(/HDD.*NVME/);
  });

  it('never sends a region from another provider', async () => {
    await createVolume({ name: 'data', size: 20, provider: 'ovh' });
    expect(apiRequest.mock.calls[0][2]).toMatchObject({ providerName: 'ovh', datacenter: 'DE1' });
  });

  it('asks for a region on a provider with no default', async () => {
    await expect(createVolume({ name: 'data', size: 20, provider: 'vultr' })).rejects.toThrow(/--region is required for vultr/);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('normalizes the type on service-create too', async () => {
    await createServiceVolume('900', { name: 'data', size: 50, storageType: 'nvme' });
    expect(apiRequest.mock.calls[0][2]).toMatchObject({ action: 'createServiceVolume', blockStorageType: 'NVME' });
  });
});

describe('sizes on OVH', () => {
  it('shows the price the customer pays, with the list price beside it', async () => {
    apiRequestNoAuth.mockResolvedValue({ instances: [
      { providerName: 'OVH', regionID: 'DE1', City: 'Frankfurt', CountryCode: 'DE', title: 'SMALL-1C-2G-D2', vCPU: 1, ramGB: '2.00', storageSizeGB: 25, pricePerHour: '0.029', offerTrafficIncludedGB: 100000000 },
      { providerName: 'NETCUP', regionID: 'nbg', City: 'Nuremberg', CountryCode: 'DE', title: 'MEDIUM-2C-4G', vCPU: 2, ramGB: '4.00', storageSizeGB: 80, pricePerHour: '0.02', offerTrafficIncludedGB: 20000 }
    ] });
    await listSizes(null, null, true);
    const [ovh, netcup] = outputJson.mock.calls[0][0];
    expect(Number(ovh.pricePerHour)).toBeCloseTo(OFFER_ON ? 0.0145 : 0.029);
    expect(ovh.listPricePerHour).toBe('0.029');
    expect(ovh.bandwidth).toBe('Unlimited');
    if (OFFER_ON) expect(ovh.launchOffer).toMatch(/50%.*2027/);
    expect(Number(netcup.pricePerHour)).toBeCloseTo(0.02);
    expect(netcup.launchOffer).toBeUndefined();
    expect(netcup.bandwidth).toBe('20000 GB');
  });
});
