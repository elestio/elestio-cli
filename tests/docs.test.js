import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { registry } from '../src/registry.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf-8');
const mentioned = new Set([...readme.matchAll(/`elestio ([a-z0-9-]+)/g)].map(m => m[1]));

describe('README stays in step with the CLI', () => {
  it('documents every command', () => {
    const undocumented = Object.keys(registry).filter(name => !mentioned.has(name));
    expect(undocumented, `undocumented commands: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('never documents a command that does not exist', () => {
    const phantom = [...mentioned].filter(name => !registry[name]);
    expect(phantom, `README documents missing commands: ${phantom.join(', ')}`).toEqual([]);
  });

  it('explains the two pipeline routes, which is where users get stuck', () => {
    expect(readme).toContain('cicd deploy-template');
    expect(readme).toContain('elestio.yml');
    expect(readme).toContain('--no-git');
  });

  it('keeps a troubleshooting entry for the empty-pipeline symptom', () => {
    expect(readme).toContain('My pipeline deployed but nothing is running');
  });
});
