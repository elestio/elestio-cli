import { describe, it, expect } from 'vitest';
import {
  OVH_LAUNCH_OFFER_END, isLaunchOfferActive, applyLaunchDiscount,
  canDowngrade, diskShrinkError, resolveRegion,
  normalizeVolumeType, volumeTypeError, volumePricePerMonth, isUnlimitedTraffic
} from '../src/providers.js';

const BEFORE = new Date('2026-10-20T00:00:00Z');
const AFTER = new Date('2027-01-01T00:00:00Z');

describe('OVH launch offer', () => {
  it('ends on 2027-01-01 UTC, like the backend', () => {
    expect(OVH_LAUNCH_OFFER_END.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(isLaunchOfferActive('ovh', BEFORE)).toBe(true);
    expect(isLaunchOfferActive('OVH', AFTER)).toBe(false);
    expect(isLaunchOfferActive('hetzner', BEFORE)).toBe(false);
  });

  it('halves the OVH list price until the offer ends', () => {
    expect(applyLaunchDiscount('OVH', '0.029', BEFORE)).toBeCloseTo(0.0145);
    expect(applyLaunchDiscount('OVH', '0.029', AFTER)).toBeCloseTo(0.029);
  });

  it('leaves other providers alone', () => {
    expect(applyLaunchDiscount('NETCUP', '0.02', BEFORE)).toBeCloseTo(0.02);
  });
});

describe('downgrades', () => {
  it('allows OVH alongside the providers that already could', () => {
    for (const p of ['netcup', 'aws', 'azure', 'scaleway', 'ovh', 'OVH']) expect(canDowngrade(p)).toBe(true);
    expect(canDowngrade('hetzner')).toBe(false);
  });

  it('refuses an OVH plan with a smaller disk, with the backend message', () => {
    expect(diskShrinkError('ovh', 100, 50))
      .toBe('OVH cannot shrink the disk (100 GB -> 50 GB), choose a plan with an equal or larger disk.');
  });

  it('accepts an equal or larger disk, and other providers', () => {
    expect(diskShrinkError('ovh', 100, 100)).toBe(null);
    expect(diskShrinkError('ovh', 50, 200)).toBe(null);
    expect(diskShrinkError('netcup', 100, 50)).toBe(null);
  });

  it('does not block when a disk size is unknown, the backend still checks', () => {
    expect(diskShrinkError('ovh', undefined, 50)).toBe(null);
  });
});

describe('resolveRegion', () => {
  const defaults = { provider: 'netcup', datacenter: 'nbg' };

  it('keeps an explicit region', () => {
    expect(resolveRegion('ovh', 'GRA11', defaults)).toBe('GRA11');
  });

  it('uses the configured region for the configured provider', () => {
    expect(resolveRegion('netcup', undefined, defaults)).toBe('nbg');
    expect(resolveRegion('NETCUP', undefined, defaults)).toBe('nbg');
  });

  it('never sends nbg to OVH: Frankfurt is its default', () => {
    expect(resolveRegion('ovh', undefined, defaults)).toBe('DE1');
  });

  it('asks for a region when the provider has no known default', () => {
    expect(() => resolveRegion('vultr', undefined, defaults)).toThrow(/--region.*elestio sizes --provider vultr/s);
  });
});

describe('volumes', () => {
  it('normalizes the type like the backend', () => {
    expect(normalizeVolumeType(undefined)).toBe('NVME');
    expect(normalizeVolumeType('hdd')).toBe('HDD');
    expect(normalizeVolumeType('ssd')).toBe(null);
  });

  it('refuses HDD in Paris and Milan on OVH', () => {
    expect(volumeTypeError('ovh', 'HDD', 'EU-WEST-PAR')).toMatch(/not available in EU-WEST-PAR/);
    expect(volumeTypeError('ovh', 'HDD', 'EU-SOUTH-MIL')).toMatch(/NVME/);
    expect(volumeTypeError('ovh', 'HDD', 'GRA11')).toBe(null);
    expect(volumeTypeError('ovh', 'NVME', 'EU-WEST-PAR')).toBe(null);
  });

  it('refuses HDD where the backend does: only Vultr and OVH offer it', () => {
    expect(volumeTypeError('hetzner', 'HDD', 'fsn1')).toMatch(/Vultr and OVH/);
    expect(volumeTypeError('vultr', 'HDD', 'ams')).toBe(null);
    expect(volumeTypeError('ovh', null, 'DE1')).toMatch(/HDD.*NVME/);
  });

  it('prices volumes with the backend per-GB rates', () => {
    expect(volumePricePerMonth('ovh', 'NVME', 100, AFTER)).toBeCloseTo(25);
    expect(volumePricePerMonth('ovh', 'HDD', 100, AFTER)).toBeCloseTo(15);
    expect(volumePricePerMonth('ovh', 'NVME', 100, BEFORE)).toBeCloseTo(12.5);
    expect(volumePricePerMonth('hetzner', 'NVME', 100)).toBeCloseTo(12);
    expect(volumePricePerMonth('aws', 'NVME', 100)).toBeCloseTo(10);
    expect(volumePricePerMonth('vultr', 'HDD', 100)).toBeCloseTo(10);
    expect(volumePricePerMonth('netcup', 'NVME', 100)).toBeCloseTo(15);
  });
});

describe('isUnlimitedTraffic', () => {
  it('recognizes the OVH sentinel values', () => {
    expect(isUnlimitedTraffic(100000000)).toBe(true);
    expect(isUnlimitedTraffic('10000000000')).toBe(true);
    expect(isUnlimitedTraffic(20000)).toBe(false);
    expect(isUnlimitedTraffic(undefined)).toBe(false);
  });
});
