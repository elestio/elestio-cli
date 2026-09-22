import { describe, it, expect } from 'vitest';
import { findCommand, suggest, renderMainHelp, renderCommandHelp } from '../src/router.js';
import { registry } from '../src/registry.js';
import { parseArgs } from '../src/utils.js';

describe('registry integrity', () => {
  it('gives every command a group and a summary', () => {
    for (const [name, command] of Object.entries(registry)) {
      expect(command.group, `${name} has no group`).toBeTruthy();
      expect(command.summary, `${name} has no summary`).toBeTruthy();
    }
  });

  it('gives every command either a run handler or actions, never neither', () => {
    for (const [name, command] of Object.entries(registry)) {
      const hasRun = typeof command.run === 'function';
      const hasActions = command.actions && Object.keys(command.actions).length > 0;
      expect(hasRun || hasActions, `${name} has no handler`).toBe(true);
    }
  });

  it('gives every action a summary and a run handler', () => {
    for (const [name, command] of Object.entries(registry)) {
      for (const [actionName, action] of Object.entries(command.actions || {})) {
        expect(action.summary, `${name} ${actionName} has no summary`).toBeTruthy();
        expect(typeof action.run, `${name} ${actionName} has no run`).toBe('function');
      }
    }
  });

  it('only names a defaultAction that exists', () => {
    for (const [name, command] of Object.entries(registry)) {
      if (!command.defaultAction) continue;
      expect(command.actions?.[command.defaultAction], `${name}: defaultAction "${command.defaultAction}" is not an action`).toBeTruthy();
    }
  });

  it('keeps every command from 1.0.x reachable', () => {
    const shipped = [
      'login', 'whoami', 'config', 'auth', 'templates', 'sizes', 'categories',
      'projects', 'services', 'service', 'deploy', 'delete-service', 'move-service',
      'wait', 'reboot', 'reset', 'shutdown', 'poweroff', 'poweron', 'restart-stack',
      'lock', 'unlock', 'resize', 'change-version', 'firewall', 'ssl', 'ssh-keys',
      'updates', 'alerts', 'backups', 'snapshots', 's3-backup', 'credentials',
      'ssh', 'vscode', 'files', 'volumes', 'cicd', 'billing'
    ];
    for (const name of shipped) {
      expect(registry[name], `${name} disappeared in the refactor`).toBeTruthy();
    }
  });

  it('keeps every cicd action from 1.0.x reachable', () => {
    const shipped = [
      'targets', 'pipelines', 'pipeline-info', 'pipeline-restart', 'pipeline-stop',
      'pipeline-delete', 'pipeline-resync', 'pipeline-logs', 'pipeline-history',
      'pipeline-log', 'domains', 'domain-add', 'domain-remove', 'create', 'template',
      'registries', 'registry-add'
    ];
    for (const action of shipped) {
      expect(registry.cicd.actions[action], `cicd ${action} disappeared`).toBeTruthy();
    }
  });

  it('exposes the new cluster and template commands', () => {
    expect(Object.keys(registry.clusters.actions)).toEqual(
      expect.arrayContaining(['list', 'info', 'nodes', 'templates', 'promote', 'failover', 'resync', 'lock', 'unlock'])
    );
    expect(registry.cicd.actions['deploy-template']).toBeTruthy();
  });
});

describe('findCommand', () => {
  it('matches exactly', () => {
    expect(findCommand(registry, 'deploy').name).toBe('deploy');
  });

  it('accepts an unambiguous prefix', () => {
    expect(findCommand(registry, 'clust').name).toBe('clusters');
    expect(findCommand(registry, 'categ').name).toBe('categories');
  });

  it('refuses an ambiguous prefix instead of guessing', () => {
    const result = findCommand(registry, 'servic');
    expect(result.name).toBe(null);
    expect(result.ambiguous).toEqual(expect.arrayContaining(['services', 'service']));
  });

  it('prefers the exact name over a longer command sharing the prefix', () => {
    expect(findCommand(registry, 'service').name).toBe('service');
    expect(findCommand(registry, 'lock').name).toBe('lock');
  });

  it('returns nothing for an unknown command', () => {
    expect(findCommand(registry, 'zzz').command).toBe(null);
  });
});

describe('suggest', () => {
  it('recovers from a transposition', () => {
    expect(suggest(registry, 'clsuter')).toContain('clusters');
  });

  it('recovers from a dropped letter', () => {
    expect(suggest(registry, 'deploi')).toContain('deploy');
    expect(suggest(registry, 'projcts')).toContain('projects');
  });

  it('stays quiet for input that resembles nothing', () => {
    expect(suggest(registry, 'qwertyuiop')).toEqual([]);
  });
});

describe('help rendering', () => {
  it('lists every visible command in the main help', () => {
    const help = renderMainHelp(registry, '1.1.0');
    for (const name of Object.keys(registry)) {
      expect(help, `${name} is missing from --help`).toContain(name);
    }
  });

  it('documents each action in the command help', () => {
    const help = renderCommandHelp('clusters', registry.clusters);
    for (const action of Object.keys(registry.clusters.actions)) {
      expect(help).toContain(action);
    }
  });

  it('marks the default action', () => {
    expect(renderCommandHelp('clusters', registry.clusters)).toContain('(default)');
  });

  it('renders flags and examples when a command declares them', () => {
    const help = renderCommandHelp('deploy', registry.deploy);
    expect(help).toContain('--cluster-mode <mode>');
    expect(help).toContain('elestio deploy postgresql --cluster --nodes 3');
  });
});

describe('flag mapping for deploy', () => {
  const flags = (line) => parseArgs(line.split(' ').slice(1));

  it('maps the cluster flags', () => {
    const args = flags('elestio deploy postgresql --cluster --nodes 3 --cluster-mode multi-master');
    expect(args._).toEqual(['deploy', 'postgresql']);
    expect(args.cluster).toBe(true);
    expect(args.nodes).toBe('3');
    expect(args['cluster-mode']).toBe('multi-master');
  });

  it('maps --no-git for deploy-template', () => {
    const args = flags('elestio cicd deploy-template n8n --target 848528 --no-git');
    expect(args._).toEqual(['cicd', 'deploy-template', 'n8n']);
    expect(args.target).toBe('848528');
    expect(args['no-git']).toBe(true);
  });
});

describe('deploy-template route selection', () => {
  // The Git route needs /api/cicd/createRepoByTemplate, which the API returns
  // 404 for today, so it is opt-in via --owner rather than the default.
  const route = (args) => !args['no-git'] && (args.git === true || args.git === 'true' || !!args.owner);

  it('defaults to the compose route', () => {
    expect(route(parseArgs(['cicd', 'deploy-template', 'n8n', '--target', '1']))).toBe(false);
  });

  it('takes the git route when an owner is given', () => {
    expect(route(parseArgs(['cicd', 'deploy-template', 'n8n', '--target', '1', '--owner', 'acme']))).toBe(true);
  });

  it('lets --no-git win over --owner', () => {
    expect(route(parseArgs(['cicd', 'deploy-template', 'n8n', '--owner', 'acme', '--no-git']))).toBe(false);
  });
});
