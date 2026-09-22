import { log, colors, outputJson } from './utils.js';

/**
 * The command table. Handlers are imported lazily so that `elestio --help` and
 * a mistyped command stay instant, and so one broken module cannot take the
 * whole CLI down.
 */

const load = {
  access: () => import('./commands/access.js'),
  actions: () => import('./commands/actions.js'),
  auth: () => import('./commands/auth.js'),
  backups: () => import('./commands/backups.js'),
  billing: () => import('./commands/billing.js'),
  cicd: () => import('./commands/cicd.js'),
  cicdTemplate: () => import('./commands/cicd-template.js'),
  clusters: () => import('./commands/clusters.js'),
  projects: () => import('./commands/projects.js'),
  services: () => import('./commands/services.js'),
  templates: () => import('./commands/templates.js'),
  volumes: () => import('./commands/volumes.js')
};

/** Reads a positional argument, falling back to named flags. */
function positional(args, index, ...flagNames) {
  for (const flag of flagNames) {
    if (args[flag] !== undefined) return args[flag];
  }
  return args._[index];
}

function requireArg(value, usage) {
  if (value === undefined || value === null || value === '') throw new Error(`Usage: elestio ${usage}`);
  return value;
}

/** A vmID-taking action: `elestio <command> <vmID>`. */
function vmAction({ group, summary, handler, module = 'actions', extra }) {
  return {
    group,
    summary,
    usage: `${summary.split(' ')[0].toLowerCase()} <vmID>`,
    async run({ args }) {
      const vmID = requireArg(args._[1], `${args._[0]} <vmID>`);
      const mod = await load[module]();
      await mod[handler](vmID, extra ? extra(args) : undefined);
    }
  };
}

export const registry = {

  // ── Auth & Config ──

  login: {
    group: 'Auth & Config',
    summary: 'Save your Elestio credentials',
    usage: 'login --email <email> --token <token>',
    flags: [
      { name: '--email <email>', summary: 'Account email' },
      { name: '--token <token>', summary: 'API token from Dashboard > Security' }
    ],
    examples: [{ description: 'Authenticate', command: 'elestio login --email you@example.com --token abc123' }],
    async run({ args, json }) {
      const { configure } = await load.auth();
      await configure(args.email || args._[1], args.token || args._[2], json);
    }
  },

  whoami: {
    group: 'Auth & Config',
    summary: 'Show the current user and default project',
    async run({ args, json }) {
      const { whoami } = await load.auth();
      whoami(json);
    }
  },

  config: {
    group: 'Auth & Config',
    summary: 'Show or update CLI configuration',
    usage: 'config [--set-default-project <id>] [--provider <p>] ...',
    flags: [
      { name: '--set-default-project <id>', summary: 'Project used when --project is omitted' },
      { name: '--provider <name>', summary: 'Default cloud provider' },
      { name: '--datacenter <code>', summary: 'Default region' },
      { name: '--server-type <size>', summary: 'Default server size' },
      { name: '--support <level>', summary: 'Default support tier' }
    ],
    async run({ args, json }) {
      const auth = await load.auth();
      if (args.email && args.token) {
        await auth.configure(args.email, args.token, json);
      } else if (args['set-default-project'] || args['default-project']) {
        auth.setDefaultProject(args['set-default-project'] || args['default-project']);
      } else if (args.provider || args.datacenter || args['server-type'] || args.support) {
        auth.setDefaults(args.provider, args.datacenter, args['server-type'], args.support);
      } else if (args._[1] === 'test') {
        await auth.testAuth(json);
      } else {
        auth.showConfig(json);
      }
    }
  },

  auth: {
    group: 'Auth & Config',
    summary: 'Test authentication',
    defaultAction: 'test',
    actions: {
      test: { summary: 'Verify the stored credentials still work', usage: 'test', async run({ json }) { (await load.auth()).testAuth(json); } }
    }
  },

  // ── Catalog ──

  templates: {
    group: 'Catalog',
    summary: 'Browse the software catalog',
    defaultAction: 'list',
    flags: [{ name: '--category <name>', summary: 'Filter by category' }],
    examples: [
      { description: 'Find PostgreSQL', command: 'elestio templates search postgres' },
      { description: 'Inspect a template', command: 'elestio templates info 11' }
    ],
    actions: {
      list: {
        summary: 'List all templates',
        usage: 'list',
        async run({ args, json }) { await (await load.templates()).listTemplates(args.category, json); }
      },
      search: {
        summary: 'Search templates by name',
        usage: 'search <query>',
        async run({ args, json }) {
          const { searchTemplates } = await load.templates();
          const results = await searchTemplates(args._[2], args.category);
          if (json) { outputJson(results.map(t => ({ id: t.id, title: t.title, category: t.category }))); return; }
          console.log(`\n${colors.bold}Search Results (${results.length})${colors.reset}\n`);
          results.forEach(t => console.log(`  ${t.id}: ${t.title} [${t.category}]`));
          console.log('');
        }
      },
      info: {
        summary: 'Show one template in detail',
        usage: 'info <id|name>',
        async run({ args, json }) {
          const { findTemplate } = await load.templates();
          const template = await findTemplate(requireArg(args._[2], 'templates info <id|name>'));
          if (!template) throw new Error(`Template "${args._[2]}" not found`);
          if (json) { outputJson(template); return; }
          console.log(`\n${colors.bold}${template.title}${colors.reset}`);
          console.log(`  ID:       ${template.id}`);
          console.log(`  Category: ${template.category}`);
          console.log(`  Version:  ${template.version || template.dockerhub_default_tag || 'latest'}`);
          if (template.description) console.log(`  Desc:     ${template.description}`);
          console.log('');
        }
      }
    }
  },

  sizes: {
    group: 'Catalog',
    summary: 'List server sizes and pricing',
    usage: 'sizes [--provider <name>] [--country <code>]',
    async run({ args, json }) { await (await load.templates()).listSizes(args.provider, args.country, json); }
  },

  categories: {
    group: 'Catalog',
    summary: 'List template categories',
    async run({ json }) { await (await load.templates()).listCategories(json); }
  },

  // ── Projects ──

  projects: {
    group: 'Projects',
    summary: 'Manage projects and their members',
    defaultAction: 'list',
    actions: {
      list: { summary: 'List all projects', usage: 'list', async run({ json }) { await (await load.projects()).listProjects(json); } },
      create: {
        summary: 'Create a project', usage: 'create <name>',
        async run({ args }) { await (await load.projects()).createProject(positional(args, 2, 'name'), args.description, args.emails); }
      },
      edit: {
        summary: 'Rename or re-describe a project', usage: 'edit <id>',
        async run({ args }) { await (await load.projects()).editProject(positional(args, 2, 'id'), args.name, args.description, args.emails); }
      },
      delete: {
        summary: 'Delete a project (--force)', usage: 'delete <id> --force',
        async run({ args }) { await (await load.projects()).deleteProject(positional(args, 2, 'id'), !!args.force); }
      },
      members: {
        summary: 'List project members', usage: 'members <projectId>',
        async run({ args, json }) { await (await load.projects()).listMembers(positional(args, 2, 'project', 'id'), json); }
      },
      'add-member': {
        summary: 'Add a member (--role)', usage: 'add-member <projectId> <email>',
        async run({ args }) { await (await load.projects()).addMember(positional(args, 2, 'project'), positional(args, 3, 'email'), args.role); }
      },
      'remove-member': {
        summary: 'Remove a member', usage: 'remove-member <projectId> <memberId>',
        async run({ args }) { await (await load.projects()).removeMember(positional(args, 2, 'project'), positional(args, 3, 'member')); }
      }
    }
  },

  // ── Services ──

  services: {
    group: 'Services',
    summary: 'List services in a project',
    usage: 'services [--project <id>]',
    async run({ args, json }) { await (await load.services()).listServices(args.project, json); }
  },

  service: {
    group: 'Services',
    summary: 'Show one service in detail',
    usage: 'service <vmID>',
    async run({ args, json }) {
      await (await load.services()).showService(requireArg(args._[1], 'service <vmID>'), args.project, json);
    }
  },

  deploy: {
    group: 'Services',
    summary: 'Deploy a service, optionally as a cluster',
    usage: 'deploy <template> [options]',
    flags: [
      { name: '--name <name>', summary: 'Service name (generated when omitted)' },
      { name: '--size <type>', summary: 'Server size, e.g. MEDIUM-2C-4G' },
      { name: '--region <code>', summary: 'Datacenter, e.g. nbg' },
      { name: '--provider <name>', summary: 'Cloud provider, e.g. hetzner' },
      { name: '--version <tag>', summary: 'Software version' },
      { name: '--cluster', summary: 'Deploy as a cluster instead of a single node' },
      { name: '--nodes <n>', summary: 'Total nodes, primary included (default: the template minimum)' },
      { name: '--cluster-mode <mode>', summary: 'primary-replica (default) or multi-master' },
      { name: '--pipeline-name <n>', summary: 'CI/CD targets: first pipeline name (max 24 chars, [a-z0-9-])' },
      { name: '--cicd-mode <mode>', summary: 'CI/CD targets: DockerCompose (default), GITHUB, GITLAB, GITLAB_SELF_HOSTED' },
      { name: '--dry-run', summary: 'Print what would be created, create nothing' },
      { name: '--wait false', summary: 'Return without waiting for the deployment' }
    ],
    examples: [
      { description: 'Single PostgreSQL node', command: 'elestio deploy postgresql --size MEDIUM-2C-4G' },
      { description: 'PostgreSQL with 2 replicas (3 VMs)', command: 'elestio deploy postgresql --cluster --nodes 3' },
      { description: 'MySQL multi-master', command: 'elestio deploy mysql --cluster --cluster-mode multi-master' },
      { description: 'Check the plan and cost first', command: 'elestio deploy clickhouse --cluster --dry-run' }
    ],
    async run({ args, json }) {
      const { deployService } = await load.services();
      await deployService(requireArg(args._[1], 'deploy <template> [options]'), {
        name: args.name, size: args.size, region: args.region,
        provider: args.provider, project: args.project,
        support: args.support, email: args.email,
        version: args.version, dryRun: !!args['dry-run'],
        wait: args.wait !== 'false', timeout: args.timeout ? parseInt(args.timeout) : undefined,
        json, pipelineName: args['pipeline-name'], cicdMode: args['cicd-mode'],
        cluster: !!args.cluster,
        nodes: args.nodes !== undefined ? Number(args.nodes) : undefined,
        clusterMode: args['cluster-mode']
      });
    }
  },

  'delete-service': {
    group: 'Services',
    summary: 'Delete a service (--force)',
    usage: 'delete-service <vmID> --force',
    async run({ args }) {
      await (await load.services()).deleteService(requireArg(args._[1], 'delete-service <vmID> --force'), {
        force: !!args.force, project: args.project, withBackups: !!args['with-backups']
      });
    }
  },

  'move-service': {
    group: 'Services',
    summary: 'Move a service to another project',
    usage: 'move-service <vmID> <targetProjectId>',
    async run({ args }) {
      const vmID = requireArg(args._[1], 'move-service <vmID> <targetProjectId>');
      const targetProject = requireArg(args._[2] || args.target, 'move-service <vmID> <targetProjectId>');
      await (await load.services()).moveService(vmID, targetProject, args.project);
    }
  },

  wait: {
    group: 'Services',
    summary: 'Block until a deployment finishes',
    usage: 'wait <vmID>',
    async run({ args }) {
      await (await load.services()).waitForDeployment(
        requireArg(args._[1], 'wait <vmID>'), args.project, args.timeout ? parseInt(args.timeout) : undefined
      );
    }
  },

  // ── Clusters ──

  clusters: {
    group: 'Clusters',
    summary: 'Manage database and application clusters',
    defaultAction: 'list',
    examples: [
      { description: 'See what can be clustered', command: 'elestio clusters templates' },
      { description: 'Create one', command: 'elestio deploy postgresql --cluster --nodes 3' },
      { description: 'Promote a replica', command: 'elestio clusters promote 7 848530 --force' }
    ],
    actions: {
      list: { summary: 'List clusters in the project', usage: 'list', async run({ args, json }) { await (await load.clusters()).listClusters(args.project, json); } },
      info: {
        summary: 'Show a cluster and its nodes', usage: 'info <clusterID>',
        async run({ args, json }) { await (await load.clusters()).showCluster(requireArg(args._[2], 'clusters info <clusterID>'), args.project, json); }
      },
      nodes: {
        summary: 'List the active nodes of a cluster', usage: 'nodes <clusterID>',
        async run({ args, json }) { await (await load.clusters()).listNodes(requireArg(args._[2], 'clusters nodes <clusterID>'), args.project, json); }
      },
      templates: {
        summary: 'List the software that supports clustering', usage: 'templates',
        async run({ json }) { await (await load.clusters()).listClusterTemplates(json); }
      },
      promote: {
        summary: 'Promote a replica to primary (--force)', usage: 'promote <clusterID> <vmID> --force',
        async run({ args }) {
          await (await load.clusters()).promoteNode(
            requireArg(args._[2], 'clusters promote <clusterID> <vmID> --force'),
            requireArg(args._[3] || args.node, 'clusters promote <clusterID> <vmID> --force'),
            args.project, !!args.force
          );
        }
      },
      failover: {
        summary: 'Turn automatic failover on or off', usage: 'failover <clusterID> on|off',
        async run({ args }) {
          await (await load.clusters()).setAutoFailover(
            requireArg(args._[2], 'clusters failover <clusterID> on|off'),
            requireArg(args._[3], 'clusters failover <clusterID> on|off')
          );
        }
      },
      resync: {
        summary: 'Re-sync replicas from the primary, erasing replica data (--force)', usage: 'resync <clusterID> --force',
        async run({ args }) { await (await load.clusters()).resyncCluster(requireArg(args._[2], 'clusters resync <clusterID> --force'), args.project, !!args.force); }
      },
      'add-node': {
        summary: 'Add a node, copying the primary (--size/--region to change; --dry-run)', usage: 'add-node <clusterID>',
        async run({ args, json }) {
          await (await load.clusters()).addClusterNode(requireArg(args._[2], 'clusters add-node <clusterID>'), {
            project: args.project, size: args.size, region: args.region, provider: args.provider,
            version: args.version, email: args.email, dryRun: !!args['dry-run'], json
          });
        }
      },
      'remove-node': {
        summary: 'Remove a replica node and its VM (--force)', usage: 'remove-node <clusterID> <vmID> --force',
        async run({ args }) {
          await (await load.clusters()).removeClusterNode(
            requireArg(args._[2], 'clusters remove-node <clusterID> <vmID> --force'),
            requireArg(args._[3], 'clusters remove-node <clusterID> <vmID> --force'),
            args.project, !!args.force
          );
        }
      },
      firewall: {
        summary: 'Show which IPs each port of a cluster accepts', usage: 'firewall <clusterID>',
        async run({ args, json }) { await (await load.clusters()).showClusterFirewall(requireArg(args._[2], 'clusters firewall <clusterID>'), args.project, json); }
      },
      'firewall-restrict': {
        summary: 'Only accept a port from given IPs, on every node', usage: 'firewall-restrict <clusterID> --port P --ips ip1,ip2',
        async run({ args }) {
          const { setClusterPortAccess, parseIpList } = await load.clusters();
          const ips = parseIpList(args.ips);
          if (ips.length === 0) throw new Error('--ips is required (comma-separated IPs or CIDR ranges). To reopen a port use firewall-open.');
          await setClusterPortAccess(requireArg(args._[2], 'clusters firewall-restrict <clusterID> --port P --ips ...'), requireArg(args.port, '--port <port>'), ips, args.project);
        }
      },
      'firewall-open': {
        summary: 'Open a port of a cluster to everyone again', usage: 'firewall-open <clusterID> --port P',
        async run({ args }) {
          await (await load.clusters()).setClusterPortAccess(requireArg(args._[2], 'clusters firewall-open <clusterID> --port P'), requireArg(args.port, '--port <port>'), [], args.project);
        }
      },
      delete: {
        summary: 'Delete a cluster and all its nodes (--force)', usage: 'delete <clusterID> --force',
        async run({ args }) { await (await load.clusters()).deleteCluster(requireArg(args._[2], 'clusters delete <clusterID> --force'), args.project, !!args.force); }
      },
      lock: {
        summary: 'Enable termination protection', usage: 'lock <clusterID>',
        async run({ args }) { await (await load.clusters()).lockCluster(requireArg(args._[2], 'clusters lock <clusterID>')); }
      },
      unlock: {
        summary: 'Disable termination protection', usage: 'unlock <clusterID>',
        async run({ args }) { await (await load.clusters()).unlockCluster(requireArg(args._[2], 'clusters unlock <clusterID>')); }
      }
    }
  },

  // ── Server Actions ──

  reboot: vmAction({ group: 'Server Actions', summary: 'Reboot a VM', handler: 'reboot' }),
  reset: vmAction({ group: 'Server Actions', summary: 'Reset a VM (hard)', handler: 'reset' }),
  shutdown: vmAction({ group: 'Server Actions', summary: 'Shutdown a VM gracefully', handler: 'shutdown' }),
  poweroff: vmAction({ group: 'Server Actions', summary: 'Poweroff a VM (forced)', handler: 'poweroff' }),
  poweron: vmAction({ group: 'Server Actions', summary: 'Poweron a VM', handler: 'poweron' }),
  'restart-stack': vmAction({ group: 'Server Actions', summary: 'Restart the Docker stack', handler: 'restartStack' }),
  lock: vmAction({ group: 'Server Actions', summary: 'Lock a VM (termination protection)', handler: 'lock' }),
  unlock: vmAction({ group: 'Server Actions', summary: 'Unlock a VM', handler: 'unlock' }),

  resize: {
    group: 'Server Actions',
    summary: 'Resize a VM',
    usage: 'resize <vmID> --size <serverType>',
    async run({ args }) {
      const { resizeServer } = await load.actions();
      await resizeServer(requireArg(args._[1], 'resize <vmID> --size <type>'), args.size || args._[2], {
        project: args.project, provider: args.provider, region: args.region,
        cpuRamOnly: args['cpu-ram-only'] !== 'false'
      });
    }
  },

  'change-version': {
    group: 'Server Actions',
    summary: 'Change the software version of a service',
    usage: 'change-version <vmID> <version>',
    async run({ args }) {
      const { changeVersion } = await load.actions();
      await changeVersion(requireArg(args._[1], 'change-version <vmID> <version>'), args._[2] || args.version);
    }
  },

  // ── Networking & Security ──

  firewall: {
    group: 'Networking & Security',
    summary: 'Manage firewall rules',
    actions: {
      get: { summary: 'Show firewall rules', usage: 'get <vmID>', async run({ args, json }) { await (await load.actions()).getFirewallRules(requireArg(args._[2], 'firewall get <vmID>'), json); } },
      enable: { summary: "Enable the firewall with rules", usage: "enable <vmID> --rules '[...]'", async run({ args }) { await (await load.actions()).enableFirewall(requireArg(args._[2], "firewall enable <vmID> --rules '[...]'"), JSON.parse(args.rules || '[]')); } },
      update: { summary: 'Replace the firewall rules', usage: "update <vmID> --rules '[...]'", async run({ args }) { await (await load.actions()).updateFirewall(requireArg(args._[2], "firewall update <vmID> --rules '[...]'"), JSON.parse(args.rules || '[]')); } },
      disable: { summary: 'Disable the firewall', usage: 'disable <vmID>', async run({ args }) { await (await load.actions()).disableFirewall(requireArg(args._[2], 'firewall disable <vmID>')); } }
    }
  },

  ssl: {
    group: 'Networking & Security',
    summary: 'Manage SSL and custom domains',
    actions: {
      list: { summary: 'List custom domains', usage: 'list <vmID>', async run({ args, json }) { await (await load.actions()).listSslDomains(requireArg(args._[2], 'ssl list <vmID>'), json); } },
      add: { summary: 'Add a custom domain', usage: 'add <vmID> <domain>', async run({ args }) { await (await load.actions()).addSslDomain(requireArg(args._[2], 'ssl add <vmID> <domain>'), positional(args, 3, 'domain')); } },
      remove: { summary: 'Remove a custom domain', usage: 'remove <vmID> <domain>', async run({ args }) { await (await load.actions()).removeSslDomain(requireArg(args._[2], 'ssl remove <vmID> <domain>'), positional(args, 3, 'domain')); } }
    }
  },

  'ssh-keys': {
    group: 'Networking & Security',
    summary: 'Manage SSH keys on a service',
    actions: {
      list: { summary: 'List SSH keys', usage: 'list <vmID>', async run({ args, json }) { await (await load.actions()).listSshKeys(requireArg(args._[2], 'ssh-keys list <vmID>'), json); } },
      add: { summary: 'Add an SSH key', usage: 'add <vmID> --name <n> --key <pubkey>', async run({ args }) { await (await load.actions()).addSshKey(requireArg(args._[2], 'ssh-keys add <vmID> --name <n> --key <pubkey>'), args.name || args._[3], args.key || args._[4]); } },
      remove: { summary: 'Remove an SSH key', usage: 'remove <vmID> --name <n>', async run({ args }) { await (await load.actions()).removeSshKey(requireArg(args._[2], 'ssh-keys remove <vmID> --name <n>'), args.name || args._[3]); } }
    }
  },

  updates: {
    group: 'Updates',
    summary: 'Manage system and application auto-updates',
    actions: {
      'system-enable': { summary: 'Enable OS auto-updates', usage: 'system-enable <vmID>', async run({ args }) { await (await load.actions()).enableSystemAutoUpdate(requireArg(args._[2], 'updates system-enable <vmID>'), { securityOnly: args['security-only'] !== 'false', dayOfWeek: args.day, hour: args.hour, minute: args.minute }); } },
      'system-disable': { summary: 'Disable OS auto-updates', usage: 'system-disable <vmID>', async run({ args }) { await (await load.actions()).disableSystemAutoUpdate(requireArg(args._[2], 'updates system-disable <vmID>')); } },
      'system-now': { summary: 'Run the OS update now', usage: 'system-now <vmID>', async run({ args }) { await (await load.actions()).runSystemUpdate(requireArg(args._[2], 'updates system-now <vmID>')); } },
      'app-enable': { summary: 'Enable application auto-updates', usage: 'app-enable <vmID>', async run({ args }) { await (await load.actions()).enableAppAutoUpdate(requireArg(args._[2], 'updates app-enable <vmID>'), { dayOfWeek: args.day, hour: args.hour, minute: args.minute }); } },
      'app-disable': { summary: 'Disable application auto-updates', usage: 'app-disable <vmID>', async run({ args }) { await (await load.actions()).disableAppAutoUpdate(requireArg(args._[2], 'updates app-disable <vmID>')); } },
      'app-now': { summary: 'Run the application update now', usage: 'app-now <vmID>', async run({ args }) { await (await load.actions()).runAppUpdate(requireArg(args._[2], 'updates app-now <vmID>')); } }
    }
  },

  alerts: {
    group: 'Monitoring',
    summary: 'Manage alert rules',
    actions: {
      get: { summary: 'Show alert rules', usage: 'get <vmID>', async run({ args, json }) { await (await load.actions()).getAlerts(requireArg(args._[2], 'alerts get <vmID>'), json); } },
      enable: { summary: 'Enable alerts', usage: "enable <vmID> --rules '[...]'", async run({ args }) { await (await load.actions()).enableAlerts(requireArg(args._[2], "alerts enable <vmID> --rules '[...]'"), JSON.parse(args.rules || '[]'), args.cycle ? parseInt(args.cycle) : 60); } },
      update: { summary: 'Replace the alert rules', usage: "update <vmID> --rules '[...]'", async run({ args }) { await (await load.actions()).enableAlerts(requireArg(args._[2], "alerts update <vmID> --rules '[...]'"), JSON.parse(args.rules || '[]'), args.cycle ? parseInt(args.cycle) : 60); } },
      disable: { summary: 'Disable alerts', usage: 'disable <vmID>', async run({ args }) { await (await load.actions()).disableAlerts(requireArg(args._[2], 'alerts disable <vmID>')); } }
    }
  },

  // ── Backups & Snapshots ──

  backups: {
    group: 'Backups & Snapshots',
    summary: 'Manage local and remote backups',
    actions: {
      'local-list': { summary: 'List local backups', usage: 'local-list <vmID>', async run({ args, json }) { await (await load.backups()).listLocalBackups(requireArg(args._[2], 'backups local-list <vmID>'), json); } },
      'local-take': { summary: 'Take a local backup', usage: 'local-take <vmID>', async run({ args }) { await (await load.backups()).takeLocalBackup(requireArg(args._[2], 'backups local-take <vmID>')); } },
      'local-restore': { summary: 'Restore a local backup', usage: 'local-restore <vmID> <path>', async run({ args }) { await (await load.backups()).restoreLocalBackup(requireArg(args._[2], 'backups local-restore <vmID> <path>'), positional(args, 3, 'path')); } },
      'local-delete': { summary: 'Delete a local backup', usage: 'local-delete <vmID> <path>', async run({ args }) { await (await load.backups()).deleteLocalBackup(requireArg(args._[2], 'backups local-delete <vmID> <path>'), positional(args, 3, 'path')); } },
      'remote-list': { summary: 'List remote backups', usage: 'remote-list <vmID>', async run({ args, json }) { await (await load.backups()).listRemoteBackups(requireArg(args._[2], 'backups remote-list <vmID>'), json); } },
      'remote-take': { summary: 'Take a remote backup', usage: 'remote-take <vmID>', async run({ args }) { await (await load.backups()).takeRemoteBackup(requireArg(args._[2], 'backups remote-take <vmID>')); } },
      'remote-restore': { summary: 'Restore a remote backup', usage: 'remote-restore <vmID> <snapshot>', async run({ args }) { await (await load.backups()).restoreRemoteBackup(requireArg(args._[2], 'backups remote-restore <vmID> <snapshot>'), positional(args, 3, 'snapshot')); } },
      'auto-enable': { summary: 'Enable scheduled backups (--path, --hour)', usage: 'auto-enable <vmID>', async run({ args }) { await (await load.backups()).setupAutoBackups(requireArg(args._[2], 'backups auto-enable <vmID>'), args.path, args.hour); } },
      'auto-disable': { summary: 'Disable scheduled backups', usage: 'auto-disable <vmID>', async run({ args }) { await (await load.backups()).disableAutoBackups(requireArg(args._[2], 'backups auto-disable <vmID>')); } }
    }
  },

  snapshots: {
    group: 'Backups & Snapshots',
    summary: 'Manage provider-level VM snapshots',
    actions: {
      list: { summary: 'List snapshots', usage: 'list <vmID>', async run({ args, json }) { await (await load.backups()).listSnapshots(requireArg(args._[2], 'snapshots list <vmID>'), json); } },
      take: { summary: 'Take a snapshot', usage: 'take <vmID>', async run({ args }) { await (await load.backups()).takeSnapshot(requireArg(args._[2], 'snapshots take <vmID>')); } },
      restore: { summary: 'Restore a snapshot (0 = most recent)', usage: 'restore <vmID> <orderID>', async run({ args }) { await (await load.backups()).restoreSnapshot(requireArg(args._[2], 'snapshots restore <vmID> <orderID>'), positional(args, 3, 'order')); } },
      delete: { summary: 'Delete a snapshot', usage: 'delete <vmID> <snapshotID>', async run({ args }) { await (await load.backups()).deleteSnapshot(requireArg(args._[2], 'snapshots delete <vmID> <snapshotID>'), positional(args, 3, 'id')); } },
      'auto-enable': { summary: 'Enable automatic snapshots', usage: 'auto-enable <vmID>', async run({ args }) { await (await load.backups()).enableAutoSnapshots(requireArg(args._[2], 'snapshots auto-enable <vmID>')); } },
      'auto-disable': { summary: 'Disable automatic snapshots', usage: 'auto-disable <vmID>', async run({ args }) { await (await load.backups()).disableAutoSnapshots(requireArg(args._[2], 'snapshots auto-disable <vmID>')); } }
    }
  },

  's3-backup': {
    group: 'Backups & Snapshots',
    summary: 'Manage backups to an external S3 bucket',
    flags: [
      { name: '--key <id>', summary: 'S3 access key' },
      { name: '--secret <secret>', summary: 'S3 secret key' },
      { name: '--bucket <name>', summary: 'Bucket name' },
      { name: '--endpoint <url>', summary: 'S3 endpoint' },
      { name: '--prefix <path>', summary: 'Key prefix' }
    ],
    actions: {
      verify: { summary: 'Check the S3 configuration', usage: 'verify <vmID>', async run({ args }) { await (await load.backups()).verifyS3Config(requireArg(args._[2], 's3-backup verify <vmID>'), s3Config(args)); } },
      enable: { summary: 'Enable S3 backups', usage: 'enable <vmID>', async run({ args }) { await (await load.backups()).enableS3Backup(requireArg(args._[2], 's3-backup enable <vmID>'), s3Config(args)); } },
      disable: { summary: 'Disable S3 backups', usage: 'disable <vmID>', async run({ args }) { await (await load.backups()).disableS3Backup(requireArg(args._[2], 's3-backup disable <vmID>')); } },
      take: { summary: 'Take an S3 backup now', usage: 'take <vmID>', async run({ args }) { await (await load.backups()).takeS3Backup(requireArg(args._[2], 's3-backup take <vmID>')); } },
      list: { summary: 'List S3 backups', usage: 'list <vmID>', async run({ args, json }) { await (await load.backups()).listS3Backups(requireArg(args._[2], 's3-backup list <vmID>'), json); } },
      restore: { summary: 'Restore an S3 backup', usage: 'restore <vmID> <key>', async run({ args }) { await (await load.backups()).restoreS3Backup(requireArg(args._[2], 's3-backup restore <vmID> <key>'), positional(args, 3, 'key')); } },
      delete: { summary: 'Delete an S3 backup', usage: 'delete <vmID> <key>', async run({ args }) { await (await load.backups()).deleteS3Backup(requireArg(args._[2], 's3-backup delete <vmID> <key>'), positional(args, 3, 'key')); } }
    }
  },

  // ── Access ──

  logs: {
    group: 'Access',
    summary: 'Open a live log view of a service (--mode install for the install log)',
    usage: 'logs <vmID> [--mode app|install]',
    async run({ args, json }) { await (await load.access()).getLogsView(requireArg(args._[1], 'logs <vmID>'), args.project, args.mode || 'app', json); }
  },

  audits: {
    group: 'Access',
    summary: 'Show the audit trail of a service (--days, default 30)',
    usage: 'audits <vmID> [--days N]',
    async run({ args, json }) { await (await load.access()).getAudits(requireArg(args._[1], 'audits <vmID>'), args.project, args.days ? Number(args.days) : 30, json); }
  },

  credentials: {
    group: 'Access',
    summary: 'Show the application credentials of a service',
    usage: 'credentials <vmID>',
    async run({ args, json }) { await (await load.access()).getCredentials(requireArg(args._[1], 'credentials <vmID>'), args.project, json); }
  },

  ssh: {
    group: 'Access',
    summary: 'Open SSH access (--direct for host details)',
    usage: 'ssh <vmID> [--direct]',
    async run({ args, json }) {
      const access = await load.access();
      const vmID = requireArg(args._[1], 'ssh <vmID>');
      if (args.direct) await access.getSSHDirect(vmID, args.project, json);
      else await access.getSSH(vmID, args.project, json);
    }
  },

  vscode: {
    group: 'Access',
    summary: 'Open VSCode in the browser',
    usage: 'vscode <vmID>',
    async run({ args, json }) { await (await load.access()).getVSCode(requireArg(args._[1], 'vscode <vmID>'), args.project, json); }
  },

  files: {
    group: 'Access',
    summary: 'Open the file explorer',
    usage: 'files <vmID>',
    async run({ args, json }) { await (await load.access()).getFileExplorer(requireArg(args._[1], 'files <vmID>'), args.project, json); }
  },

  // ── Volumes ──

  volumes: {
    group: 'Volumes',
    summary: 'Manage block storage volumes',
    defaultAction: 'list',
    actions: {
      list: { summary: 'List volumes in the project', usage: 'list', async run({ args, json }) { await (await load.volumes()).listVolumes(args.project, json); } },
      create: { summary: 'Create a standalone volume', usage: 'create --name <n> --size <gb>', async run({ args }) { await (await load.volumes()).createVolume({ name: args.name || args._[2], size: args.size ? parseInt(args.size) : undefined, provider: args.provider, datacenter: args.datacenter, projectId: args.project, serverId: args.server, storageType: args.type }); } },
      'service-list': { summary: 'List volumes attached to a service', usage: 'service-list <vmID>', async run({ args, json }) { await (await load.volumes()).getServiceVolumes(requireArg(args._[2], 'volumes service-list <vmID>'), json); } },
      'service-create': { summary: 'Create and attach a volume', usage: 'service-create <vmID> --name <n> --size <gb>', async run({ args }) { await (await load.volumes()).createServiceVolume(requireArg(args._[2], 'volumes service-create <vmID> --name <n>'), { name: args.name || args._[3], size: args.size ? parseInt(args.size) : undefined, storageType: args.type }); } },
      resize: { summary: 'Resize a volume', usage: 'resize <vmID> <volumeID> --size <gb>', async run({ args }) { await (await load.volumes()).resizeVolume(requireArg(args._[2], 'volumes resize <vmID> <volumeID> --size <gb>'), positional(args, 3, 'volume'), parseInt(args.size || args._[4])); } },
      detach: { summary: 'Detach a volume (--keep false deletes it)', usage: 'detach <vmID> <volumeID>', async run({ args }) { await (await load.volumes()).detachVolume(requireArg(args._[2], 'volumes detach <vmID> <volumeID>'), positional(args, 3, 'volume'), { keepVolume: args.keep !== 'false' }); } },
      delete: { summary: 'Delete a volume', usage: 'delete <vmID> <volumeID>', async run({ args }) { await (await load.volumes()).deleteServiceVolume(requireArg(args._[2], 'volumes delete <vmID> <volumeID>'), positional(args, 3, 'volume')); } },
      protect: { summary: 'Toggle volume protection (--disable)', usage: 'protect <vmID> <volumeID>', async run({ args }) { await (await load.volumes()).setVolumeProtection(requireArg(args._[2], 'volumes protect <vmID> <volumeID>'), positional(args, 3, 'volume'), args.disable !== true); } }
    }
  },

  // ── CI/CD ──

  cicd: {
    group: 'CI/CD',
    summary: 'Manage CI/CD targets and pipelines',
    examples: [
      { description: 'Deploy catalog software as a pipeline (the usual case)', command: 'elestio cicd deploy-template n8n --target 848528' },
      { description: 'See what it would create first', command: 'elestio cicd deploy-template n8n --target 848528 --dry-run' },
      { description: 'Git route: generates the repo in your account, keeps lifecycle scripts', command: 'elestio cicd deploy-template n8n --target 848528 --owner my-github-user' },
      { description: 'Pipeline from your own repo', command: 'elestio cicd create --auto --target 848528 --name my-app --repo acme/my-app' }
    ],
    actions: {
      'deploy-template': {
        summary: 'Deploy catalog software as a pipeline, configured from its elestio.yml',
        usage: 'deploy-template <software> --target <vmID>',
        async run({ args, json }) {
          const { deployTemplate } = await load.cicdTemplate();
          await deployTemplate(requireArg(args._[2], 'cicd deploy-template <software> --target <vmID>'), {
            target: args.target, project: args.project, name: args.name,
            owner: args.owner, branch: args.branch, repoName: args['repo-name'],
            gitType: args['git-type'], authId: args['auth-id'],
            git: !args['no-git'] && (args.git === true || args.git === 'true' || !!args.owner),
            private: !!args.private, nonOrg: !!args['non-org'],
            buildCmd: args['build-cmd'], runCmd: args['run-cmd'],
            installCmd: args['install-cmd'], buildDir: args['build-dir'],
            variables: args.variables,
            dryRun: !!args['dry-run'], force: !!args.force, json
          });
        }
      },
      templates: {
        summary: 'List catalog software deployable as a pipeline',
        usage: 'templates [query]',
        async run({ args, json }) { await (await load.cicdTemplate()).listDeployableTemplates(args._[2], json); }
      },
      targets: { summary: 'List CI/CD targets', usage: 'targets', async run({ args, json }) { await (await load.cicd()).getCicdServices(args.project, json); } },
      pipelines: { summary: 'List pipelines on a target', usage: 'pipelines <vmID>', async run({ args, json }) { await (await load.cicd()).getServicePipelines(requireArg(args._[2], 'cicd pipelines <vmID>'), args.project, json); } },
      'pipeline-info': { summary: 'Show pipeline details', usage: 'pipeline-info <vmID> <pipelineID>', async run({ args, json }) { await (await load.cicd()).getPipelineDetails(requireArg(args._[2], 'cicd pipeline-info <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project, json); } },
      'pipeline-restart': { summary: 'Restart a pipeline', usage: 'pipeline-restart <vmID> <pipelineID>', async run({ args }) { await (await load.cicd()).restartPipeline(requireArg(args._[2], 'cicd pipeline-restart <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project); } },
      'pipeline-stop': { summary: 'Stop a pipeline', usage: 'pipeline-stop <vmID> <pipelineID>', async run({ args }) { await (await load.cicd()).stopPipeline(requireArg(args._[2], 'cicd pipeline-stop <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project); } },
      'pipeline-delete': { summary: 'Delete a pipeline (--force)', usage: 'pipeline-delete <vmID> <pipelineID> --force', async run({ args }) { await (await load.cicd()).deletePipeline(requireArg(args._[2], 'cicd pipeline-delete <vmID> <pipelineID> --force'), positional(args, 3, 'pipeline'), args.project, !!args.force); } },
      'pipeline-resync': { summary: 'Re-sync a pipeline', usage: 'pipeline-resync <vmID> <pipelineID>', async run({ args }) { await (await load.cicd()).resyncPipeline(requireArg(args._[2], 'cicd pipeline-resync <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project); } },
      'pipeline-logs': { summary: 'Tail the running pipeline logs', usage: 'pipeline-logs <vmID> <pipelineID>', async run({ args }) { await (await load.cicd()).getPipelineLogs(requireArg(args._[2], 'cicd pipeline-logs <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project); } },
      'pipeline-history': { summary: 'Show the build history', usage: 'pipeline-history <vmID> <pipelineID>', async run({ args, json }) { await (await load.cicd()).getPipelineHistory(requireArg(args._[2], 'cicd pipeline-history <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project, json); } },
      'pipeline-log': { summary: 'Print one build log file', usage: 'pipeline-log <vmID> --pipeline <id> --file <path>', async run({ args }) { await (await load.cicd()).viewPipelineLog(requireArg(args._[2], 'cicd pipeline-log <vmID> --pipeline <id> --file <path>'), args.pipeline, args.file, args.project); } },
      domains: { summary: 'List pipeline domains', usage: 'domains <vmID> <pipelineID>', async run({ args, json }) { await (await load.cicd()).listPipelineDomains(requireArg(args._[2], 'cicd domains <vmID> <pipelineID>'), positional(args, 3, 'pipeline'), args.project, json); } },
      'domain-add': { summary: 'Add a pipeline domain', usage: 'domain-add <vmID> --pipeline <id> --domain <d>', async run({ args }) { await (await load.cicd()).addPipelineDomain(requireArg(args._[2], 'cicd domain-add <vmID> --pipeline <id> --domain <d>'), args.pipeline, args.domain || args._[3], args.project); } },
      'domain-remove': { summary: 'Remove a pipeline domain', usage: 'domain-remove <vmID> --pipeline <id> --domain <d>', async run({ args }) { await (await load.cicd()).removePipelineDomain(requireArg(args._[2], 'cicd domain-remove <vmID> --pipeline <id> --domain <d>'), args.pipeline, args.domain || args._[3], args.project); } },
      create: {
        summary: 'Create a pipeline from your own repo (--auto) or a JSON file',
        usage: 'create --auto --target <vmID> --name <n> --repo <owner/repo>',
        async run({ args }) {
          const cicd = await load.cicd();
          if (!args.auto) { await cicd.createPipeline(args._[2] || args.file); return; }
          await cicd.autoCreatePipeline({
            project: args.project, target: args.target, name: args.name,
            mode: args.mode, repo: args.repo, branch: args.branch,
            authId: args['auth-id'], image: args.image, imageTag: args['image-tag'],
            buildDir: args['build-dir'], rootDir: args['root-dir'],
            framework: args.framework, buildCmd: args['build-cmd'],
            runCmd: args['run-cmd'], installCmd: args['install-cmd'],
            nodeVersion: args['node-version'], variables: args.variables,
            compose: args.compose
          });
        }
      },
      template: { summary: 'Print a pipeline config template', usage: 'template [mode]', async run({ args }) { console.log((await load.cicd()).generatePipelineTemplate(args._[2] || args.mode || 'docker')); } },
      registries: { summary: 'List Docker registries', usage: 'registries', async run({ args, json }) { await (await load.cicd()).getDockerRegistries(args.project, json); } },
      'registry-add': {
        summary: 'Add a Docker registry',
        usage: 'registry-add --name <n> --username <u> --password <p> --url <repo>',
        async run({ args }) {
          await (await load.cicd()).addDockerRegistry(
            args.project, args.name || args._[2], args.username || args._[3],
            args.password, args.url,
            args['registry-type'] || args.registryType || 'docker.io',
            args['repo-id'] || args.repoId || '',
            args['gitlab-url'] || args.gitlabUrl || ''
          );
        }
      }
    }
  },

  // ── Billing ──

  billing: {
    group: 'Billing',
    summary: 'View billing totals',
    defaultAction: 'summary',
    actions: {
      summary: { summary: 'Account-wide billing summary', usage: 'summary', async run({ json }) { await (await load.billing()).getBillingSummary(json); } },
      project: { summary: 'Billing for one project', usage: 'project <projectId>', async run({ args, json }) { await (await load.billing()).getProjectBilling(positional(args, 2, 'project'), json); } }
    }
  }
};

function s3Config(args) {
  return {
    apiKey: args.key, secretKey: args.secret, bucketName: args.bucket,
    endPoint: args.endpoint, prefix: args.prefix, providerType: args.type
  };
}
