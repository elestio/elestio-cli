import { colors, log } from './utils.js';

/**
 * Declarative command dispatch.
 *
 * Commands describe themselves - group, usage, flags, sub-actions - so the
 * help screens are generated from the same data the router dispatches on.
 * A command and its documentation cannot drift apart.
 */

/**
 * @typedef {object} Command
 * @property {string}   group     heading it appears under in `elestio --help`
 * @property {string}   summary   one line, shown in the command list
 * @property {string}   [usage]   argument shape, without the leading `elestio`
 * @property {object}   [actions] sub-action name -> { summary, usage, run }
 * @property {string}   [defaultAction] action used when none is given
 * @property {Function} [run]     handler for commands without sub-actions
 * @property {string[]} [flags]   documented flags, shown in `elestio <cmd> --help`
 */

export function findCommand(registry, name) {
  if (registry[name]) return { name, command: registry[name] };

  // Accept an unambiguous prefix so `elestio clust list` works.
  const matches = Object.keys(registry).filter(key => key.startsWith(name));
  if (matches.length === 1) return { name: matches[0], command: registry[matches[0]] };

  return { name: null, command: null, ambiguous: matches.length > 1 ? matches : null };
}

export function suggest(registry, name) {
  // Generous enough to catch a transposition ("clsuter" is 3 edits from
  // "clusters"), tight enough not to propose unrelated commands.
  const threshold = Math.max(2, Math.ceil(name.length / 3));

  const candidates = Object.keys(registry)
    .map(key => ({
      key,
      // A command that contains what was typed is almost always the one meant.
      distance: key.includes(name) || name.includes(key) ? 0 : editDistance(name, key)
    }))
    .filter(c => c.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.key.length - b.key.length);

  return candidates.slice(0, 3).map(c => c.key);
}

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = a[i - 1] === b[j - 1]
        ? rows[i - 1][j - 1]
        : 1 + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

export function renderMainHelp(registry, version) {
  const groups = new Map();
  for (const [name, command] of Object.entries(registry)) {
    if (command.hidden) continue;
    if (!groups.has(command.group)) groups.set(command.group, []);
    groups.get(command.group).push({ name, ...command });
  }

  const width = Math.max(...Object.keys(registry).map(n => n.length)) + 2;
  const lines = [
    '',
    `${colors.bold}Elestio CLI${colors.reset} v${version}`,
    'Deploy and manage services on the Elestio DevOps platform.',
    '',
    `${colors.bold}Usage:${colors.reset} elestio <command> [action] [options]`,
    ''
  ];

  for (const [group, commands] of groups) {
    lines.push(`${colors.bold}${group}${colors.reset}`);
    for (const command of commands) {
      lines.push(`  ${colors.cyan}${command.name.padEnd(width)}${colors.reset}${command.summary}`);
    }
    lines.push('');
  }

  lines.push(
    `${colors.bold}Global Options${colors.reset}`,
    `  ${'--json'.padEnd(width + 2)}Output in JSON format`,
    `  ${'--project <id>'.padEnd(width + 2)}Project ID (overrides the default)`,
    `  ${'--debug'.padEnd(width + 2)}Print full error stack traces`,
    `  ${'--help, -h'.padEnd(width + 2)}Show help`,
    `  ${'--version, -v'.padEnd(width + 2)}Show version`,
    '',
    `Run ${colors.cyan}elestio <command> --help${colors.reset} for a command's actions and flags.`,
    `Use ${colors.cyan}--flag=value${colors.reset} for values that start with a dash.`,
    ''
  );

  return lines.join('\n');
}

export function renderCommandHelp(name, command) {
  const lines = ['', `${colors.bold}elestio ${command.usage || name}${colors.reset}`, `  ${command.summary}`, ''];

  if (command.actions) {
    const entries = Object.entries(command.actions).filter(([, a]) => !a.hidden);
    const width = Math.max(...entries.map(([, a]) => (a.usage || '').length), 12) + 2;

    lines.push(`${colors.bold}Actions${colors.reset}`);
    for (const [actionName, action] of entries) {
      const usage = action.usage || actionName;
      const marker = actionName === command.defaultAction ? `${colors.dim} (default)${colors.reset}` : '';
      lines.push(`  ${colors.cyan}${usage.padEnd(width)}${colors.reset}${action.summary}${marker}`);
    }
    lines.push('');
  }

  if (command.flags?.length) {
    const width = Math.max(...command.flags.map(f => f.name.length)) + 2;
    lines.push(`${colors.bold}Options${colors.reset}`);
    for (const flag of command.flags) {
      lines.push(`  ${flag.name.padEnd(width)}${flag.summary}`);
    }
    lines.push('');
  }

  if (command.examples?.length) {
    lines.push(`${colors.bold}Examples${colors.reset}`);
    for (const example of command.examples) {
      lines.push(`  ${colors.dim}# ${example.description}${colors.reset}`);
      lines.push(`  ${example.command}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Resolves a command and its action, then runs it.
 * Returns an exit code; never throws for user error.
 */
export async function dispatch(registry, argv, args, context) {
  const requested = args._[0];
  const { name, command, ambiguous } = findCommand(registry, requested);

  if (ambiguous) {
    log('error', `"${requested}" is ambiguous: ${ambiguous.join(', ')}`);
    return 1;
  }

  if (!command) {
    log('error', `Unknown command: ${requested}`);
    const suggestions = suggest(registry, requested);
    if (suggestions.length > 0) {
      log('info', `Did you mean: ${suggestions.join(', ')}?`);
    }
    log('info', 'Run "elestio --help" for the full list');
    return 1;
  }

  if (args.help || args.h) {
    console.log(renderCommandHelp(name, command));
    return 0;
  }

  if (!command.actions) {
    await command.run({ ...context, args, json: context.json });
    return 0;
  }

  const requestedAction = args._[1];
  const actionName = requestedAction && command.actions[requestedAction]
    ? requestedAction
    : (!requestedAction ? command.defaultAction : null);

  if (!actionName) {
    log('error', `Unknown action "${requestedAction}" for "${name}"`);
    console.log(renderCommandHelp(name, command));
    return 1;
  }

  await command.actions[actionName].run({ ...context, args, json: context.json });
  return 0;
}
