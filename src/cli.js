import { createRequire } from 'module';
import { parseArgs, log } from './utils.js';
import { registry } from './registry.js';
import { dispatch, renderMainHelp } from './router.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export async function run(argv) {
  const args = parseArgs(argv);

  if (args.version || args.v) {
    console.log(pkg.version);
    return;
  }

  if (!args._[0] || ((args.help || args.h) && !args._[0])) {
    console.log(renderMainHelp(registry, pkg.version));
    return;
  }

  try {
    const code = await dispatch(registry, argv, args, { json: !!args.json });
    if (code !== 0) process.exitCode = code;
  } catch (err) {
    log('error', err.message);
    if (args.debug) console.error(err);
    process.exitCode = 1;
  }
}

export { registry };
