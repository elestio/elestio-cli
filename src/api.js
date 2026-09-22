import { loadConfig, saveConfig } from './config.js';

const BASE_URL = 'https://api.elest.io';

// Requests that exceed this are aborted rather than hanging the CLI forever.
const REQUEST_TIMEOUT_MS = 60000;

// ── JWT management ──

function isJwtExpired(config) {
  if (!config.jwt || !config.jwtExpiry) return true;
  return Date.now() > (config.jwtExpiry - 300000); // 5 min buffer
}

/**
 * Wraps fetch with a timeout and turns transport failures into readable errors.
 */
async function httpRequest(url, options) {
  let response;

  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Request to ${BASE_URL} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`Cannot reach ${BASE_URL}: ${err.message}`);
  }

  return response;
}

/**
 * The API returns HTML on gateway errors, so response.json() alone would surface
 * "Unexpected token <" instead of the real problem.
 */
async function parseJson(response, endpoint) {
  const text = await response.text();

  if (text === '') {
    if (response.ok) return {};
    throw new Error(`${endpoint} failed: HTTP ${response.status} ${response.statusText} (empty response)`);
  }

  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
    throw new Error(`${endpoint} returned a non-JSON response (HTTP ${response.status}): ${snippet}`);
  }
}

async function authenticate(email, token) {
  const response = await httpRequest(`${BASE_URL}/api/auth/checkAPIToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, token })
  });

  const data = await parseJson(response, '/api/auth/checkAPIToken');

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
    saveConfig({ ...config, jwt: auth.jwt, jwtExpiry: auth.jwtExpiry });
    return auth.jwt;
  }

  return config.jwt;
}

// ── API requests ──

function clearJwt() {
  const config = loadConfig();
  saveConfig({ ...config, jwt: null, jwtExpiry: null });
}

export async function apiRequest(endpoint, method = 'POST', body = {}, retried = false) {
  const jwt = await getJwt();

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    options.body = JSON.stringify({ jwt, ...body });
  }

  // GET routes read parameters from the query string only (backend requirement).
  const url = method === 'GET'
    ? `${BASE_URL}${endpoint}?${new URLSearchParams({ jwt, ...body })}`
    : `${BASE_URL}${endpoint}`;

  const response = await httpRequest(url, options);

  if (response.status === 401 && !retried) {
    clearJwt();
    return apiRequest(endpoint, method, body, true);
  }

  const data = await parseJson(response, endpoint);

  const isAuthError = !retried && (
    (data.status === 'error' && data.message?.toLowerCase().includes('auth')) ||
    (data.code === 'InvalidToken') ||
    (data.message?.toLowerCase().includes('invalid token'))
  );

  if (isAuthError) {
    clearJwt();
    return apiRequest(endpoint, method, body, true);
  }

  return data;
}

export async function apiRequestNoAuth(endpoint, method = 'GET') {
  const response = await httpRequest(`${BASE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json' }
  });
  return parseJson(response, endpoint);
}

export { BASE_URL, authenticate };
