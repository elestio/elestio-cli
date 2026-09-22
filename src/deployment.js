/**
 * Deployment tracking, kept free of I/O so it can be tested.
 *
 * createServer answers a single service with one providerServerID, but a
 * cluster with every node in one comma-separated string ("947349,947350").
 * Comparing that string to a service's vmID never matches, so waiting on a
 * cluster used to run until the timeout.
 */

export function parseVmIDs(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map(id => String(id).trim()).filter(Boolean);
}

function matches(service, id) {
  return String(service.vmID) === id || String(service.providerServerID) === id;
}

function isReady(service) {
  return service.deploymentStatus === 'Deployed' && service.status === 'running';
}

export function deploymentProgress(services, ids) {
  const found = ids.map(id => ({ id, service: services.find(s => matches(s, id)) }));
  const present = found.filter(f => f.service);

  return {
    services: present.map(f => f.service),
    missing: found.filter(f => !f.service).map(f => f.id),
    done: ids.length > 0 && present.length === ids.length && present.every(f => isReady(f.service)),
    summary: present.map(f => `${f.id}: ${f.service.deploymentStatus}`).join(', ')
  };
}
