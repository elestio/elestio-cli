import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

/**
 * The registry calls handlers by name through lazy imports, so a typo would
 * only surface when a user runs that exact command. This walks the registry
 * source and checks every referenced export actually exists.
 */

const MODULES = {
  access: () => import('../src/commands/access.js'),
  actions: () => import('../src/commands/actions.js'),
  auth: () => import('../src/commands/auth.js'),
  backups: () => import('../src/commands/backups.js'),
  billing: () => import('../src/commands/billing.js'),
  cicd: () => import('../src/commands/cicd.js'),
  cicdTemplate: () => import('../src/commands/cicd-template.js'),
  clusters: () => import('../src/commands/clusters.js'),
  projects: () => import('../src/commands/projects.js'),
  services: () => import('../src/commands/services.js'),
  templates: () => import('../src/commands/templates.js'),
  volumes: () => import('../src/commands/volumes.js')
};

const source = readFileSync(new URL('../src/registry.js', import.meta.url), 'utf-8');

function referencedHandlers() {
  const found = new Set();
  // (await load.services()).deployService  /  const { x } = await load.auth()
  for (const m of source.matchAll(/\(await load\.(\w+)\(\)\)\.(\w+)/g)) found.add(`${m[1]}.${m[2]}`);
  for (const m of source.matchAll(/const \{ ([\w, ]+) \} = await load\.(\w+)\(\)/g)) {
    for (const name of m[1].split(',').map(s => s.trim())) found.add(`${m[2]}.${name}`);
  }
  return [...found].sort();
}

describe('registry handlers', () => {
  const refs = referencedHandlers();

  it('references a non-trivial number of handlers', () => {
    expect(refs.length).toBeGreaterThan(60);
  });

  it('every module named in the registry is loadable', async () => {
    for (const [name, loader] of Object.entries(MODULES)) {
      await expect(loader(), `module ${name} failed to load`).resolves.toBeTruthy();
    }
  });

  it.each(refs)('%s is exported', async (ref) => {
    const [moduleName, handler] = ref.split('.');
    expect(MODULES[moduleName], `registry references unknown module "${moduleName}"`).toBeTruthy();
    const mod = await MODULES[moduleName]();
    expect(typeof mod[handler], `${moduleName}.js does not export ${handler}`).toBe('function');
  });
});
