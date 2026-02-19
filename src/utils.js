// ── ANSI Colors ──

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m'
};

// ── Logging ──

export function log(type, message) {
  const prefix = {
    info: `${colors.blue}[INFO]${colors.reset}`,
    success: `${colors.green}[SUCCESS]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`,
    warn: `${colors.yellow}[WARN]${colors.reset}`,
    debug: `${colors.gray}[DEBUG]${colors.reset}`
  };
  console.log(`${prefix[type] || ''} ${message}`);
}

// ── Argument parsing ──

export function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];

      if (next && !next.startsWith('-')) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = argv[i + 1];

      if (next && !next.startsWith('-')) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i++;
      }
    } else {
      args._.push(arg);
      i++;
    }
  }

  return args;
}

// ── Table formatting ──

export function formatTable(data, columns) {
  if (!data || data.length === 0) return 'No data';

  const widths = {};
  columns.forEach(col => { widths[col.key] = col.label.length; });

  data.forEach(row => {
    columns.forEach(col => {
      const val = String(row[col.key] ?? '');
      widths[col.key] = Math.max(widths[col.key], val.length);
    });
  });

  const header = columns.map(col => col.label.padEnd(widths[col.key])).join('  ');
  const separator = columns.map(col => '-'.repeat(widths[col.key])).join('  ');
  const rows = data.map(row =>
    columns.map(col => String(row[col.key] ?? '').padEnd(widths[col.key])).join('  ')
  );

  return [header, separator, ...rows].join('\n');
}

// ── Helpers ──

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatPrice(pricePerHour) {
  const hourly = parseFloat(pricePerHour);
  const monthly = (hourly * 24 * 30).toFixed(2);
  return `$${monthly}/mo`;
}

export function validateServerName(name) {
  if (!name) return { valid: false, error: 'Server name is required' };
  if (name.length < 3) return { valid: false, error: 'Server name must be at least 3 characters' };
  if (name.length > 50) return { valid: false, error: 'Server name must be at most 50 characters' };
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name) && name.length > 1) {
    return { valid: false, error: 'Server name must be lowercase alphanumeric with hyphens, cannot start/end with hyphen' };
  }
  return { valid: true };
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatService(svc) {
  const status = svc.status === 'running'
    ? `${colors.green}running${colors.reset}`
    : `${colors.yellow}${svc.status}${colors.reset}`;

  const deployment = svc.deploymentStatus === 'Deployed'
    ? `${colors.green}Deployed${colors.reset}`
    : `${colors.yellow}${svc.deploymentStatus}${colors.reset}`;

  return `
${colors.bold}${svc.displayName}${colors.reset} (${svc.templateName || 'CI/CD'})
  Status: ${status} | Deployment: ${deployment}
  IP: ${svc.ipv4 || 'pending'}
  URL: https://${svc.cname || 'pending'}/
  vmID: ${svc.vmID} | serverID: ${svc.id}
  Size: ${svc.serverType} (${svc.cores} cores, ${svc.ramGB}GB RAM)
  Provider: ${svc.provider} / ${svc.datacenter || 'N/A'}
  Cost: ${formatPrice(svc.pricePerHour)}`.trim();
}

export function showHelp(command, subcommands) {
  console.log(`\n${colors.bold}Usage:${colors.reset} elestio ${command} <action> [options]\n`);
  console.log(`${colors.bold}Actions:${colors.reset}`);
  Object.entries(subcommands).forEach(([name, desc]) => {
    console.log(`  ${colors.cyan}${name.padEnd(25)}${colors.reset} ${desc}`);
  });
  console.log('');
}

export function truncate(str, maxLen = 30) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

// ── JSON output helper ──

export function outputJson(data) {
  console.log(JSON.stringify(data, null, 2));
}
