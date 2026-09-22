// ── Clustering ──
//
// The catalog marks clusterable software with isCluster=1, and that is what we
// trust: it tracks new templates on its own. The list below is only the offline
// fallback for when a template object is unavailable -- it mirrors the
// dashboard's hardcoded list and is therefore always at risk of lagging.

export const CLUSTER_TEMPLATE_IDS = [
  3,   // Redis
  11,  // PostgreSQL
  12,  // MySQL
  45,  // TimescaleDB
  54,  // N8N
  66,  // Vaultwarden
  75,  // KeyDB
  93,  // ClickHouse
  108, // Keycloak
  183, // Vault
  195, // OpenSearch
  212, // RabbitMQ
  309, // Nebula
  436, // Valkey
  467, // rke2
  488, // Nats
  490, // pgvector
  497  // pgDuckDB
];

// Quorum-based software needs an odd number of nodes to elect a leader.
export const CLUSTER_MIN_THREE_NODES = [93, 183, 195, 212, 467, 488];

// Only MySQL offers writes on more than one node.
export const CLUSTER_MULTI_MASTER_TEMPLATE_IDS = [12];

export const CLUSTER_MAX_NODES = 15;

export const CLUSTER_MODES = ['primary-replica', 'multi-master'];

/**
 * Minimum node count (primary included) accepted for a template.
 */
export function minClusterNodes(templateId) {
  return CLUSTER_MIN_THREE_NODES.includes(Number(templateId)) ? 3 : 2;
}

/**
 * @param {object|number} template  a catalog template, or just its ID
 */
export function supportsClustering(template) {
  if (template && typeof template === 'object' && template.isCluster !== undefined) {
    return Number(template.isCluster) === 1;
  }
  const id = Number(template && typeof template === 'object' ? template.id : template);
  return CLUSTER_TEMPLATE_IDS.includes(id);
}

export function supportsMultiMaster(templateId) {
  return CLUSTER_MULTI_MASTER_TEMPLATE_IDS.includes(Number(templateId));
}

// ── CI/CD ──

export const CICD_TARGET_TEMPLATE_ID = 234;

// Accepted by createServer's cicdPayload.CICDMode and by createCiCdExistServer.
export const CICD_MODES = ['GITHUB', 'GITLAB', 'GITLAB_SELF_HOSTED', 'DockerCompose'];

// Where `elestio cicd deploy-template` sources catalog software from.
export const TEMPLATE_REPO_OWNER = 'elestio-examples';
export const TEMPLATE_REPO_HOST = 'https://github.com';

export const RUNTIME_PRESETS = {
  static: { runtime: 'staticSPA', buildDir: '/dist', framework: 'Vite.js', buildCmd: 'npm run build', runCmd: '', installCmd: 'npm install', version: '20', containerPort: '3000' },
  node: { runtime: 'NodeJs', buildDir: '/', framework: 'No Framework', buildCmd: 'npm run build', runCmd: 'npm start', installCmd: 'npm install', version: '20', containerPort: '3000' },
  docker: { runtime: 'NodeJs', buildDir: '/', framework: 'NoFramework', buildCmd: '', runCmd: '', installCmd: '', version: '20', containerPort: '3000' }
};
