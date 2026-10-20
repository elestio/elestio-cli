import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({ apiRequest: vi.fn(async () => ({ status: 'OK' })) }));
vi.mock('../src/utils.js', async (orig) => ({ ...(await orig()), log: vi.fn() }));
vi.mock('../src/commands/services.js', () => ({ getServiceDetails: vi.fn() }));
vi.mock('../src/commands/templates.js', () => ({ filterSizes: vi.fn() }));

const { apiRequest } = await import('../src/api.js');
const { getServiceDetails } = await import('../src/commands/services.js');
const { filterSizes } = await import('../src/commands/templates.js');
const { resizeServer } = await import('../src/commands/actions.js');

const size = (title, storageSizeGB, regionID = 'DE1') => ({ providerName: 'OVH', regionID, title, storageSizeGB });
const OVH_SIZES = [
  size('LARGE-4C-8G', 100), size('LARGE-4C-8G-D2', 50), size('MEDIUM-2C-4G', 50),
  size('XLARGE-4C-16G', 100), size('2XLARGE-8C-32G', 200)
];

function onOvh(serverType) {
  getServiceDetails.mockResolvedValue({ provider: 'ovh', datacenter: 'DE1', serverType });
  filterSizes.mockResolvedValue(OVH_SIZES);
}

const changeTypeCalls = () => apiRequest.mock.calls.filter(c => c[2]?.action === 'changeType');

describe('resizeServer on OVH', () => {
  beforeEach(() => { apiRequest.mockClear(); });

  it('allows a downgrade that keeps the disk size', async () => {
    onOvh('XLARGE-4C-16G');
    await resizeServer('900', 'LARGE-4C-8G');
    expect(changeTypeCalls()[0][2]).toMatchObject({ newType: 'LARGE-4C-8G', providerName: 'ovh', region: 'DE1' });
  });

  it('refuses a plan with a smaller disk before calling the API', async () => {
    onOvh('LARGE-4C-8G');
    await expect(resizeServer('900', 'MEDIUM-2C-4G')).rejects
      .toThrow('OVH cannot shrink the disk (100 GB -> 50 GB), choose a plan with an equal or larger disk.');
    expect(changeTypeCalls()).toHaveLength(0);
  });

  it('catches a smaller disk even when CPU and RAM stay the same', async () => {
    onOvh('LARGE-4C-8G');
    await expect(resizeServer('900', 'LARGE-4C-8G-D2')).rejects.toThrow(/cannot shrink the disk/);
  });

  it('allows an upgrade to a bigger disk', async () => {
    onOvh('LARGE-4C-8G');
    await resizeServer('900', '2XLARGE-8C-32G');
    expect(changeTypeCalls()).toHaveLength(1);
  });
});

describe('resizeServer elsewhere', () => {
  beforeEach(() => { apiRequest.mockClear(); });

  it('still refuses downgrades on Hetzner', async () => {
    getServiceDetails.mockResolvedValue({ provider: 'hetzner', datacenter: 'fsn1', serverType: 'LARGE-4C-8G' });
    filterSizes.mockResolvedValue([
      { providerName: 'HETZNER', regionID: 'fsn1', title: 'LARGE-4C-8G', storageSizeGB: 160 },
      { providerName: 'HETZNER', regionID: 'fsn1', title: 'MEDIUM-2C-4G', storageSizeGB: 80 }
    ]);
    await expect(resizeServer('900', 'MEDIUM-2C-4G')).rejects.toThrow(/Downgrade not supported on hetzner/);
  });
});
