import { apiRequestNoAuth } from '../api.js';
import { formatTable, colors, truncate, outputJson } from '../utils.js';

let templatesCache = null;
let sizesCache = null;

export async function getTemplates() {
  if (templatesCache) return templatesCache;
  const response = await apiRequestNoAuth('/api/servers/getTemplates');
  templatesCache = response.instances || [];
  return templatesCache;
}

export async function searchTemplates(query, category = null) {
  const templates = await getTemplates();
  const q = query?.toLowerCase() || '';

  return templates.filter(t => {
    const matchesQuery = !q ||
      t.title?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q);
    const matchesCategory = !category ||
      t.category?.toLowerCase().includes(category.toLowerCase());
    return matchesQuery && matchesCategory;
  });
}

const TEMPLATE_ALIASES = {
  'cicd': 'CI-CD-Target',
  'ci-cd': 'CI-CD-Target',
  'postgres': 'PostgreSQL',
  'pg': 'PostgreSQL',
  'mysql': 'MySQL',
  'mariadb': 'MariaDB',
  'mongo': 'MongoDB',
  'mongodb': 'MongoDB',
  'elastic': 'Elasticsearch',
  'elasticsearch': 'Elasticsearch',
  'wp': 'Wordpress',
  'wordpress': 'Wordpress',
  'k8s': 'K3S',
  'kubernetes': 'K3S'
};

export async function findTemplate(nameOrId) {
  const templates = await getTemplates();

  const byId = templates.find(t => String(t.id) === String(nameOrId));
  if (byId) return byId;

  const aliasedName = TEMPLATE_ALIASES[nameOrId?.toLowerCase()];
  if (aliasedName) {
    const byAlias = templates.find(t => t.title?.toLowerCase() === aliasedName.toLowerCase());
    if (byAlias) return byAlias;
  }

  const byTitle = templates.find(t => t.title?.toLowerCase() === nameOrId?.toLowerCase());
  if (byTitle) return byTitle;

  return templates.find(t => t.title?.toLowerCase().includes(nameOrId?.toLowerCase()));
}

export async function listTemplates(category = null, json = false) {
  const templates = category
    ? await searchTemplates(null, category)
    : await getTemplates();

  if (json) {
    outputJson(templates.map(t => ({ id: t.id, title: t.title, category: t.category, version: t.version || 'latest' })));
    return;
  }

  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Name' },
    { key: 'category', label: 'Category' },
    { key: 'version', label: 'Version' }
  ];

  const data = templates.map(t => ({
    id: t.id,
    title: t.title,
    category: truncate(t.category, 25),
    version: t.version || 'latest'
  }));

  console.log(`\n${colors.bold}Templates (${templates.length})${colors.reset}\n`);
  console.log(formatTable(data, columns));
  console.log('');
}

export async function getServerSizes() {
  if (sizesCache) return sizesCache;
  const response = await apiRequestNoAuth('/api/servers/getServerSizes');
  sizesCache = response.instances || [];
  return sizesCache;
}

export async function filterSizes(provider = null, country = null) {
  const sizes = await getServerSizes();
  return sizes.filter(s => {
    const matchesProvider = !provider || s.providerName?.toLowerCase() === provider.toLowerCase();
    const matchesCountry = !country ||
      s.Country?.toLowerCase().includes(country.toLowerCase()) ||
      s.CountryCode?.toLowerCase() === country.toLowerCase();
    return matchesProvider && matchesCountry;
  });
}

export async function validateCombo(provider, datacenter, serverType) {
  const sizes = await getServerSizes();
  return sizes.find(s =>
    s.providerName?.toLowerCase() === provider?.toLowerCase() &&
    s.regionID?.toLowerCase() === datacenter?.toLowerCase() &&
    s.title?.toLowerCase() === serverType?.toLowerCase()
  );
}

export async function listSizes(provider = null, country = null, json = false) {
  const sizes = await filterSizes(provider, country);

  if (json) {
    outputJson(sizes.map(s => ({
      provider: s.providerName,
      region: s.regionID,
      location: `${s.City}, ${s.CountryCode}`,
      size: s.title,
      cpu: s.vCPU,
      ramGB: s.ramGB,
      storageGB: s.storageSizeGB,
      pricePerHour: s.pricePerHour,
      priceMonthly: (parseFloat(s.pricePerHour) * 24 * 30).toFixed(0)
    })));
    return;
  }

  const byProvider = {};
  sizes.forEach(s => {
    if (!byProvider[s.providerName]) byProvider[s.providerName] = [];
    byProvider[s.providerName].push(s);
  });

  console.log(`\n${colors.bold}Server Sizes (${sizes.length} options)${colors.reset}\n`);

  Object.entries(byProvider).forEach(([providerName, providerSizes]) => {
    console.log(`${colors.cyan}${providerName}${colors.reset}`);

    const columns = [
      { key: 'regionID', label: 'Region' },
      { key: 'location', label: 'Location' },
      { key: 'title', label: 'Size' },
      { key: 'vCPU', label: 'CPU' },
      { key: 'ramGB', label: 'RAM' },
      { key: 'storage', label: 'Storage' },
      { key: 'price', label: 'Price/mo' }
    ];

    const data = providerSizes.slice(0, 20).map(s => ({
      regionID: s.regionID,
      location: `${s.City}, ${s.CountryCode}`,
      title: s.title,
      vCPU: s.vCPU,
      ramGB: s.ramGB + 'GB',
      storage: s.storageSizeGB + 'GB ' + (s.storageType || ''),
      price: '$' + (parseFloat(s.pricePerHour) * 24 * 30).toFixed(0)
    }));

    console.log(formatTable(data, columns));
    if (providerSizes.length > 20) {
      console.log(`  ... and ${providerSizes.length - 20} more`);
    }
    console.log('');
  });
}

export async function listCategories(json = false) {
  const templates = await getTemplates();
  const categories = [...new Set(templates.map(t => t.category))].filter(Boolean).sort();

  if (json) {
    outputJson(categories);
    return;
  }

  console.log(`\n${colors.bold}Template Categories${colors.reset}\n`);
  categories.forEach(c => console.log(`  ${c}`));
  console.log('');
}
