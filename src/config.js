import fs from 'fs';
import path from 'path';
import os from 'os';

const ELESTIO_DIR = path.join(os.homedir(), '.elestio');
const CREDENTIALS_PATH = path.join(ELESTIO_DIR, 'credentials');
const CONFIG_PATH = path.join(ELESTIO_DIR, 'config.json');

const DEFAULT_CONFIG = {
  jwt: null,
  jwtExpiry: null,
  defaultProject: null,
  defaults: {
    provider: 'netcup',
    datacenter: 'nbg',
    serverType: 'MEDIUM-2C-4G',
    support: 'level1'
  }
};

function ensureDir() {
  if (!fs.existsSync(ELESTIO_DIR)) {
    fs.mkdirSync(ELESTIO_DIR, { mode: 0o700, recursive: true });
  }
}

// ── Credentials (email + apiToken) ──

export function getCredentials() {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
      return {
        email: data.email || null,
        apiToken: data.apiToken || null
      };
    }
  } catch {
    // ignore
  }
  return { email: null, apiToken: null };
}

export function saveCredentials(email, apiToken) {
  ensureDir();
  fs.writeFileSync(
    CREDENTIALS_PATH,
    JSON.stringify({ email, apiToken }, null, 2),
    { mode: 0o600 }
  );
}

// ── Config (jwt, defaults, defaultProject) ──

export function loadConfig() {
  let config = { ...DEFAULT_CONFIG };

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      config = { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // ignore
  }

  // Merge credentials into config for convenience
  const creds = getCredentials();
  config.email = creds.email;
  config.apiToken = creds.apiToken;

  return config;
}

export function saveConfig(config) {
  ensureDir();
  // Never persist credentials in config.json
  const { email, apiToken, ...safeConfig } = config;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
}

// ── Exports ──

export { ELESTIO_DIR, CREDENTIALS_PATH, CONFIG_PATH };
