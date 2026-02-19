import { loadConfig, saveConfig, getCredentials } from './config.js';
import { log } from './utils.js';

const BASE_URL = 'https://api.elest.io';

// ── JWT management ──

function isJwtExpired(config) {
  if (!config.jwt || !config.jwtExpiry) return true;
  return Date.now() > (config.jwtExpiry - 300000); // 5 min buffer
}

async function authenticate(email, token) {
  const response = await fetch(`${BASE_URL}/api/auth/checkAPIToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token })
  });

  const data = await response.json();

  if (data.status !== 'OK' || !data.jwt) {
    throw new Error(data.message || 'Authentication failed');
  }

  return {
    jwt: data.jwt,
    jwtExpiry: Date.now() + (23 * 60 * 60 * 1000) // 23h
  };
}

export async function getJwt() {
  const config = loadConfig();

  if (!config.email || !config.apiToken) {
    throw new Error('Not configured. Run: elestio login');
  }

  if (isJwtExpired(config)) {
    const auth = await authenticate(config.email, config.apiToken);
    config.jwt = auth.jwt;
    config.jwtExpiry = auth.jwtExpiry;
    saveConfig(config);
  }

  return config.jwt;
}

// ── API requests ──

export async function apiRequest(endpoint, method = 'POST', body = {}, retried = false) {
  const jwt = await getJwt();

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    options.body = JSON.stringify({ jwt, ...body });
  }

  const url = method === 'GET' && Object.keys(body).length > 0
    ? `${BASE_URL}${endpoint}?${new URLSearchParams({ jwt, ...body })}`
    : `${BASE_URL}${endpoint}`;

  const response = await fetch(url, options);

  if (response.status === 401 && !retried) {
    const config = loadConfig();
    config.jwt = null;
    config.jwtExpiry = null;
    saveConfig(config);
    return apiRequest(endpoint, method, body, true);
  }

  const data = await response.json();

  const isAuthError = !retried && (
    (data.status === 'error' && data.message?.toLowerCase().includes('auth')) ||
    (data.code === 'InvalidToken') ||
    (data.message?.toLowerCase().includes('invalid token'))
  );

  if (isAuthError) {
    const config = loadConfig();
    config.jwt = null;
    config.jwtExpiry = null;
    saveConfig(config);
    return apiRequest(endpoint, method, body, true);
  }

  return data;
}

export async function apiRequestNoAuth(endpoint, method = 'GET') {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' }
  });
  return response.json();
}

export { BASE_URL, authenticate };
