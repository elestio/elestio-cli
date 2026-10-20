// Provider rules the API does not expose, mirrored from the backend
// (helper/constant.js, helper/ovh/index.js, api/volumes/createVolume.js).

// OVH launch offer: getServerSizes returns the list price, the backend bills
// half of it on every OVH resource (services, load balancers, volumes; not
// support plans) until this date.
export const OVH_LAUNCH_DISCOUNT = 0.5;
export const OVH_LAUNCH_OFFER_END = new Date('2027-01-01T00:00:00Z');
export const OVH_LAUNCH_OFFER_LABEL = 'OVH launch offer: 50% off until Jan 1, 2027';

const isOvh = (provider) => String(provider || '').toLowerCase() === 'ovh';

export function isLaunchOfferActive(provider, now = new Date()) {
  return isOvh(provider) && now < OVH_LAUNCH_OFFER_END;
}

// Price the customer pays, from a list price (hourly VM or monthly per-GB volume).
export function applyLaunchDiscount(provider, listPrice, now = new Date()) {
  const price = parseFloat(listPrice);
  return isLaunchOfferActive(provider, now) ? price * (1 - OVH_LAUNCH_DISCOUNT) : price;
}

// ── Resize ──

export const DOWNGRADE_SUPPORTED_PROVIDERS = ['netcup', 'aws', 'azure', 'scaleway', 'ovh'];

export function canDowngrade(provider) {
  return DOWNGRADE_SUPPORTED_PROVIDERS.includes(String(provider || '').toLowerCase());
}

// OVH resizes both ways but never shrinks the disk.
export function cannotShrinkDisk(provider) {
  return isOvh(provider);
}

// null when the change is fine.
export function diskShrinkError(provider, currentDiskGB, targetDiskGB) {
  if (!cannotShrinkDisk(provider)) return null;
  const current = Number(currentDiskGB);
  const target = Number(targetDiskGB);
  if (!current || !target || target >= current) return null;
  return `OVH cannot shrink the disk (${current} GB -> ${target} GB), choose a plan with an equal or larger disk.`;
}

// ── Regions ──

// Used when --provider is given without --region. The configured default
// region belongs to the configured provider only (nbg does not exist on OVH).
export const DEFAULT_REGIONS = { netcup: 'nbg', ovh: 'DE1' };

export function resolveRegion(provider, region, defaults = {}) {
  if (region) return region;
  const p = String(provider || '').toLowerCase();
  if (defaults.datacenter && p === String(defaults.provider || '').toLowerCase()) return defaults.datacenter;
  if (DEFAULT_REGIONS[p]) return DEFAULT_REGIONS[p];
  throw new Error(`--region is required for ${provider}. List its regions with: elestio sizes --provider ${p}`);
}

// ── Volumes ──

const HDD_PROVIDERS = ['vultr', 'ovh'];
export const OVH_NO_HDD_REGIONS = ['EU-WEST-PAR', 'EU-SOUTH-MIL'];

// 'NVME' (default) or 'HDD'; null for anything else.
export function normalizeVolumeType(value) {
  const t = String(value == null ? '' : value).trim().toUpperCase();
  if (t === '') return 'NVME';
  return t === 'HDD' || t === 'NVME' ? t : null;
}

export function volumeTypeError(provider, type, region) {
  if (!type) return 'Invalid volume type, use HDD (classic) or NVME (high speed).';
  const p = String(provider || '').toLowerCase();
  if (type !== 'HDD') return null;
  if (!HDD_PROVIDERS.includes(p)) return 'HDD volumes are only supported by Vultr and OVH.';
  if (p === 'ovh' && OVH_NO_HDD_REGIONS.includes(String(region).toUpperCase())) {
    return `HDD (classic) volumes are not available in ${region}, use --type NVME.`;
  }
  return null;
}

// $/GB/month, as billed by the backend.
const VOLUME_PRICE = { ovhNvme: 0.25, ovhHdd: 0.15, hetzner: 0.12, basic: 0.1, default: 0.15 };

export function volumePricePerMonth(provider, type, sizeGB, now = new Date()) {
  const p = String(provider || '').toLowerCase();
  const size = parseInt(sizeGB, 10) || 0;
  if (p === 'ovh') {
    const rate = type === 'HDD' ? VOLUME_PRICE.ovhHdd : VOLUME_PRICE.ovhNvme;
    // The launch offer covers OVH volumes too (confirmed by the backend team).
    return size * applyLaunchDiscount('ovh', rate, now);
  }
  if (p === 'hetzner') return size * VOLUME_PRICE.hetzner;
  if (p === 'aws' || type === 'HDD') return size * VOLUME_PRICE.basic;
  return size * VOLUME_PRICE.default;
}

// ── Bandwidth ──

// OVH reports unmetered traffic as a huge offerTrafficIncludedGB.
const UNLIMITED_TRAFFIC_GB = 10000000;

export function isUnlimitedTraffic(trafficGB) {
  const gb = Number(trafficGB);
  return Number.isFinite(gb) && gb >= UNLIMITED_TRAFFIC_GB;
}
