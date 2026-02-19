import { parseArgs, log, colors, showHelp } from './utils.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// ── Main help ──

function printHelp() {
  console.log(`
${colors.bold}Elestio CLI${colors.reset} v${pkg.version}
Deploy and manage services on the Elestio DevOps platform.

${colors.bold}Usage:${colors.reset} elestio <command> [action] [options]

${colors.bold}Auth & Config${colors.reset}
  login                     Configure credentials (--email, --token)
  whoami                    Show current user
  config                    Show/update configuration
  auth test                 Test authentication

${colors.bold}Catalog${colors.reset}
  templates                 Browse software templates
  sizes                     List server sizes and pricing
  categories                List template categories

${colors.bold}Projects${colors.reset}
  projects                  Manage projects (list, create, edit, delete, members)

${colors.bold}Services${colors.reset}
  services                  List services in a project
  service                   Show service details
  deploy                    Deploy a new service
  delete-service            Delete a service
  move-service              Move a service to another project
  wait <vmID>               Wait for a deployment to complete

${colors.bold}Server Actions${colors.reset}
  reboot <vmID>             Reboot a VM
  reset <vmID>              Hard reset a VM
  shutdown <vmID>           Shutdown a VM
  poweroff <vmID>           Force power off
  poweron <vmID>            Power on a VM
  restart-stack <vmID>      Restart Docker stack
  lock <vmID>               Enable termination protection
  unlock <vmID>             Disable termination protection
  resize <vmID>             Resize a VM

${colors.bold}Networking & Security${colors.reset}
  firewall                  Manage firewall rules
  ssl                       Manage SSL/custom domains
  ssh-keys                  Manage SSH keys

${colors.bold}Updates${colors.reset}
  updates                   Manage auto-updates (system & app)

${colors.bold}Monitoring${colors.reset}
  alerts                    Manage alert rules

${colors.bold}Backups & Snapshots${colors.reset}
  backups                   Manage local/remote backups
  snapshots                 Manage VM snapshots
  s3-backup                 Manage S3 external backups

${colors.bold}Access${colors.reset}
  credentials <vmID>        Get app credentials
  ssh <vmID>                Get SSH/web terminal access
  vscode <vmID>             Get VSCode web access
  files <vmID>              Get file explorer access

${colors.bold}Volumes${colors.reset}
  volumes                   Manage block storage volumes

${colors.bold}CI/CD${colors.reset}
  cicd                      Manage CI/CD targets and pipelines

${colors.bold}Billing${colors.reset}
  billing                   View billing summary and details

${colors.bold}Global Options${colors.reset}
  --json                    Output in JSON format
  --project <id>            Specify project ID
  --help, -h                Show help
  --version, -v             Show version
`);
}

// ── Command router ──

export async function run(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  const action = args._[1];
  const json = !!args.json;

  try {
    if (args.version || args.v) {
      console.log(pkg.version);
      return;
    }

    if (!command || args.help || args.h) {
      printHelp();
      return;
    }

    switch (command) {

      // ── Auth & Config ──

      case 'login': {
        const { configure } = await import('./commands/auth.js');
        await configure(args.email || args._[1], args.token || args._[2], json);
        break;
      }

      case 'whoami': {
        const { whoami } = await import('./commands/auth.js');
        whoami(json);
        break;
      }

      case 'config': {
        const auth = await import('./commands/auth.js');
        if (args.email && args.token) {
          await auth.configure(args.email, args.token, json);
        } else if (args['set-default-project'] || args['default-project']) {
          auth.setDefaultProject(args['set-default-project'] || args['default-project']);
        } else if (args.provider || args.datacenter || args['server-type'] || args.support) {
          auth.setDefaults(args.provider, args.datacenter, args['server-type'], args.support);
        } else if (action === 'test') {
          await auth.testAuth(json);
        } else {
          auth.showConfig(json);
        }
        break;
      }

      // ── Catalog ──

      case 'templates': {
        const { listTemplates, searchTemplates, findTemplate } = await import('./commands/templates.js');
        if (action === 'search') {
          const results = await searchTemplates(args._[2], args.category);
          if (json) {
            const { outputJson } = await import('./utils.js');
            outputJson(results.map(t => ({ id: t.id, title: t.title, category: t.category })));
          } else {
            console.log(`\n${colors.bold}Search Results (${results.length})${colors.reset}\n`);
            results.forEach(t => console.log(`  ${t.id}: ${t.title} [${t.category}]`));
            console.log('');
          }
        } else if (action === 'info') {
          const template = await findTemplate(args._[2]);
          if (!template) throw new Error(`Template "${args._[2]}" not found`);
          if (json) {
            const { outputJson } = await import('./utils.js');
            outputJson(template);
          } else {
            console.log(`\n${colors.bold}${template.title}${colors.reset}`);
            console.log(`  ID:       ${template.id}`);
            console.log(`  Category: ${template.category}`);
            console.log(`  Version:  ${template.version || template.dockerhub_default_tag || 'latest'}`);
            if (template.description) console.log(`  Desc:     ${template.description}`);
            console.log('');
          }
        } else {
          await listTemplates(args.category, json);
        }
        break;
      }

      case 'sizes': {
        const { listSizes } = await import('./commands/templates.js');
        await listSizes(args.provider, args.country, json);
        break;
      }

      case 'categories': {
        const { listCategories } = await import('./commands/templates.js');
        await listCategories(json);
        break;
      }

      // ── Projects ──

      case 'projects': {
        const projects = await import('./commands/projects.js');
        switch (action) {
          case 'create':
            await projects.createProject(args._[2] || args.name, args.description, args.emails);
            break;
          case 'edit':
            await projects.editProject(args._[2] || args.id, args.name, args.description, args.emails);
            break;
          case 'delete':
            await projects.deleteProject(args._[2] || args.id, !!args.force);
            break;
          case 'members':
            await projects.listMembers(args._[2] || args.project || args.id, json);
            break;
          case 'add-member':
            await projects.addMember(args._[2] || args.project, args._[3] || args.email, args.role);
            break;
          case 'remove-member':
            await projects.removeMember(args._[2] || args.project, args._[3] || args.member);
            break;
          default:
            if (action && action !== 'list') {
              showHelp('projects', {
                'list': 'List all projects',
                'create <name>': 'Create a project',
                'edit <id>': 'Edit a project (--name, --description)',
                'delete <id>': 'Delete a project (--force)',
                'members <projectId>': 'List project members',
                'add-member <projectId> <email>': 'Add a member (--role)',
                'remove-member <projectId> <memberId>': 'Remove a member'
              });
            } else {
              await projects.listProjects(json);
            }
        }
        break;
      }

      // ── Services ──

      case 'services': {
        const { listServices } = await import('./commands/services.js');
        await listServices(args.project, json);
        break;
      }

      case 'service': {
        const { showService } = await import('./commands/services.js');
        if (!action) throw new Error('Usage: elestio service <vmID>');
        await showService(action, args.project, json);
        break;
      }

      case 'deploy': {
        const { deployService } = await import('./commands/services.js');
        if (!action) throw new Error('Usage: elestio deploy <template> [options]');
        await deployService(action, {
          name: args.name, size: args.size, region: args.region,
          provider: args.provider, project: args.project,
          support: args.support, email: args.email,
          version: args.version, dryRun: !!args['dry-run'],
          wait: args.wait !== 'false', timeout: args.timeout ? parseInt(args.timeout) : undefined,
          json, pipelineName: args['pipeline-name']
        });
        break;
      }

      case 'delete-service': {
        const { deleteService } = await import('./commands/services.js');
        if (!action) throw new Error('Usage: elestio delete-service <vmID> --force');
        await deleteService(action, { force: !!args.force, project: args.project, withBackups: !!args['with-backups'] });
        break;
      }

      case 'move-service': {
        const { moveService } = await import('./commands/services.js');
        const vmID = args._[1];
        const targetProject = args._[2] || args.target;
        if (!vmID || !targetProject) throw new Error('Usage: elestio move-service <vmID> <targetProjectId>');
        await moveService(vmID, targetProject, args.project);
        break;
      }

      case 'wait': {
        const { waitForDeployment } = await import('./commands/services.js');
        if (!action) throw new Error('Usage: elestio wait <vmID> [--project <id>]');
        await waitForDeployment(action, args.project, args.timeout ? parseInt(args.timeout) : undefined);
        break;
      }

      // ── Auth ──

      case 'auth': {
        const auth = await import('./commands/auth.js');
        if (action === 'test' || !action) {
          await auth.testAuth(json);
        } else {
          showHelp('auth', { 'test': 'Test authentication' });
        }
        break;
      }

      // ── Server Actions ──

      case 'reboot': {
        const { reboot } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio reboot <vmID>');
        await reboot(action);
        break;
      }

      case 'reset': {
        const { reset } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio reset <vmID>');
        await reset(action);
        break;
      }

      case 'shutdown': {
        const { shutdown } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio shutdown <vmID>');
        await shutdown(action, { project: args.project });
        break;
      }

      case 'poweroff': {
        const { poweroff } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio poweroff <vmID>');
        await poweroff(action);
        break;
      }

      case 'poweron': {
        const { poweron } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio poweron <vmID>');
        await poweron(action);
        break;
      }

      case 'restart-stack': {
        const { restartStack } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio restart-stack <vmID>');
        await restartStack(action);
        break;
      }

      case 'lock': {
        const { lock } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio lock <vmID>');
        await lock(action);
        break;
      }

      case 'unlock': {
        const { unlock } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio unlock <vmID>');
        await unlock(action);
        break;
      }

      case 'resize': {
        const { resizeServer } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio resize <vmID> --size <type>');
        await resizeServer(action, args.size || args._[2], { project: args.project, provider: args.provider, region: args.region, cpuRamOnly: args['cpu-ram-only'] !== 'false' });
        break;
      }

      case 'change-version': {
        const { changeVersion } = await import('./commands/actions.js');
        if (!action) throw new Error('Usage: elestio change-version <vmID> <version>');
        await changeVersion(action, args._[2] || args.version);
        break;
      }

      // ── Firewall ──

      case 'firewall': {
        const actions = await import('./commands/actions.js');
        const vmID = args._[2];
        switch (action) {
          case 'get':
            if (!vmID) throw new Error('Usage: elestio firewall get <vmID>');
            await actions.getFirewallRules(vmID, json);
            break;
          case 'enable':
            if (!vmID) throw new Error('Usage: elestio firewall enable <vmID> --rules \'[...]\'');
            await actions.enableFirewall(vmID, JSON.parse(args.rules || '[]'));
            break;
          case 'update':
            if (!vmID) throw new Error('Usage: elestio firewall update <vmID> --rules \'[...]\'');
            await actions.updateFirewall(vmID, JSON.parse(args.rules || '[]'));
            break;
          case 'disable':
            if (!vmID) throw new Error('Usage: elestio firewall disable <vmID>');
            await actions.disableFirewall(vmID);
            break;
          default:
            showHelp('firewall', {
              'get <vmID>': 'Show firewall rules',
              'enable <vmID> --rules \'[...]\'': 'Enable firewall with rules',
              'update <vmID> --rules \'[...]\'': 'Update firewall rules',
              'disable <vmID>': 'Disable firewall'
            });
        }
        break;
      }

      // ── SSL / Custom Domains ──

      case 'ssl': {
        const actions = await import('./commands/actions.js');
        switch (action) {
          case 'list':
            await actions.listSslDomains(args._[2], json);
            break;
          case 'add':
            await actions.addSslDomain(args._[2], args._[3] || args.domain);
            break;
          case 'remove':
            await actions.removeSslDomain(args._[2], args._[3] || args.domain);
            break;
          default:
            showHelp('ssl', {
              'list <vmID>': 'List custom domains',
              'add <vmID> <domain>': 'Add a custom domain with auto-SSL',
              'remove <vmID> <domain>': 'Remove a custom domain'
            });
        }
        break;
      }

      // ── SSH Keys ──

      case 'ssh-keys': {
        const actions = await import('./commands/actions.js');
        switch (action) {
          case 'list':
            await actions.listSshKeys(args._[2], json);
            break;
          case 'add':
            await actions.addSshKey(args._[2], args.name || args._[3], args.key || args._[4]);
            break;
          case 'remove':
            await actions.removeSshKey(args._[2], args.name || args._[3]);
            break;
          default:
            showHelp('ssh-keys', {
              'list <vmID>': 'List SSH keys',
              'add <vmID> --name <name> --key <key>': 'Add an SSH key',
              'remove <vmID> --name <name>': 'Remove an SSH key'
            });
        }
        break;
      }

      // ── Updates ──

      case 'updates': {
        const actions = await import('./commands/actions.js');
        switch (action) {
          case 'system-enable':
            await actions.enableSystemAutoUpdate(args._[2], { day: args.day, hour: args.hour, minute: args.minute, securityOnly: args['security-only'] !== 'false' });
            break;
          case 'system-disable':
            await actions.disableSystemAutoUpdate(args._[2]);
            break;
          case 'system-now':
            await actions.runSystemUpdate(args._[2]);
            break;
          case 'app-enable':
            await actions.enableAppAutoUpdate(args._[2], { day: args.day, hour: args.hour, minute: args.minute });
            break;
          case 'app-disable':
            await actions.disableAppAutoUpdate(args._[2]);
            break;
          case 'app-now':
            await actions.runAppUpdate(args._[2]);
            break;
          default:
            showHelp('updates', {
              'system-enable <vmID>': 'Enable OS auto-updates (--day, --hour, --minute)',
              'system-disable <vmID>': 'Disable OS auto-updates',
              'system-now <vmID>': 'Run OS update now',
              'app-enable <vmID>': 'Enable app auto-updates (--day, --hour, --minute)',
              'app-disable <vmID>': 'Disable app auto-updates',
              'app-now <vmID>': 'Run app update now'
            });
        }
        break;
      }

      // ── Alerts ──

      case 'alerts': {
        const actions = await import('./commands/actions.js');
        switch (action) {
          case 'get':
            await actions.getAlerts(args._[2], json);
            break;
          case 'enable':
          case 'update':
            await actions.enableAlerts(args._[2], args.rules ? JSON.parse(args.rules) : undefined, args.cycle);
            break;
          case 'disable':
            await actions.disableAlerts(args._[2]);
            break;
          default:
            showHelp('alerts', {
              'get <vmID>': 'Show alert rules',
              'enable <vmID> --rules \'...\'': 'Enable/update alerts',
              'disable <vmID>': 'Disable alerts'
            });
        }
        break;
      }

      // ── Backups ──

      case 'backups': {
        const backups = await import('./commands/backups.js');
        switch (action) {
          // Local
          case 'local-list':
            await backups.listLocalBackups(args._[2], json);
            break;
          case 'local-take':
            await backups.takeLocalBackup(args._[2]);
            break;
          case 'local-restore':
            await backups.restoreLocalBackup(args._[2], args._[3] || args.path);
            break;
          case 'local-delete':
            await backups.deleteLocalBackup(args._[2], args._[3] || args.path);
            break;
          // Remote
          case 'remote-list':
            await backups.listRemoteBackups(args._[2], json);
            break;
          case 'remote-take':
            await backups.takeRemoteBackup(args._[2]);
            break;
          case 'remote-restore':
            await backups.restoreRemoteBackup(args._[2], args._[3] || args.snapshot);
            break;
          case 'auto-enable':
            await backups.setupAutoBackups(args._[2], args.path, args.hour);
            break;
          case 'auto-disable':
            await backups.disableAutoBackups(args._[2]);
            break;
          default:
            showHelp('backups', {
              'local-list <vmID>': 'List local backups',
              'local-take <vmID>': 'Take a local backup',
              'local-restore <vmID> <path>': 'Restore a local backup',
              'local-delete <vmID> <path>': 'Delete a local backup',
              'remote-list <vmID>': 'List remote backups',
              'remote-take <vmID>': 'Take a remote backup',
              'remote-restore <vmID> <snapshot>': 'Restore a remote backup',
              'auto-enable <vmID>': 'Setup auto backups (--path, --hour)',
              'auto-disable <vmID>': 'Disable auto backups'
            });
        }
        break;
      }

      // ── Snapshots ──

      case 'snapshots': {
        const backups = await import('./commands/backups.js');
        switch (action) {
          case 'list':
            await backups.listSnapshots(args._[2], json);
            break;
          case 'take':
            await backups.takeSnapshot(args._[2]);
            break;
          case 'restore':
            await backups.restoreSnapshot(args._[2], args._[3] || args.order);
            break;
          case 'delete':
            await backups.deleteSnapshot(args._[2], args._[3] || args.id);
            break;
          case 'auto-enable':
            await backups.enableAutoSnapshots(args._[2]);
            break;
          case 'auto-disable':
            await backups.disableAutoSnapshots(args._[2]);
            break;
          default:
            showHelp('snapshots', {
              'list <vmID>': 'List snapshots',
              'take <vmID>': 'Take a snapshot',
              'restore <vmID> <orderID>': 'Restore a snapshot (0 = most recent)',
              'delete <vmID> <snapshotID>': 'Delete a snapshot',
              'auto-enable <vmID>': 'Enable auto snapshots',
              'auto-disable <vmID>': 'Disable auto snapshots'
            });
        }
        break;
      }

      // ── S3 External Backups ──

      case 's3-backup': {
        const backups = await import('./commands/backups.js');
        switch (action) {
          case 'verify':
            await backups.verifyS3Config(args._[2], { apiKey: args.key, secretKey: args.secret, bucketName: args.bucket, endPoint: args.endpoint, prefix: args.prefix, providerType: args.type });
            break;
          case 'enable':
            await backups.enableS3Backup(args._[2], { apiKey: args.key, secretKey: args.secret, bucketName: args.bucket, endPoint: args.endpoint, prefix: args.prefix, providerType: args.type });
            break;
          case 'disable':
            await backups.disableS3Backup(args._[2]);
            break;
          case 'take':
            await backups.takeS3Backup(args._[2]);
            break;
          case 'list':
            await backups.listS3Backups(args._[2], json);
            break;
          case 'restore':
            await backups.restoreS3Backup(args._[2], args._[3] || args.key);
            break;
          case 'delete':
            await backups.deleteS3Backup(args._[2], args._[3] || args.key);
            break;
          default:
            showHelp('s3-backup', {
              'verify <vmID>': 'Verify S3 config (--key, --secret, --bucket, --endpoint)',
              'enable <vmID>': 'Enable S3 backup (--key, --secret, --bucket, --endpoint)',
              'disable <vmID>': 'Disable S3 backup',
              'take <vmID>': 'Take S3 backup now',
              'list <vmID>': 'List S3 backups',
              'restore <vmID> <key>': 'Restore S3 backup',
              'delete <vmID> <key>': 'Delete S3 backup'
            });
        }
        break;
      }

      // ── Access ──

      case 'credentials': {
        const { getCredentials } = await import('./commands/access.js');
        if (!action) throw new Error('Usage: elestio credentials <vmID>');
        await getCredentials(action, args.project, json);
        break;
      }

      case 'ssh': {
        const access = await import('./commands/access.js');
        if (!action) throw new Error('Usage: elestio ssh <vmID>');
        if (args.direct) {
          await access.getSSHDirect(action, json);
        } else {
          await access.getSSH(action, args.project, json);
        }
        break;
      }

      case 'vscode': {
        const { getVSCode } = await import('./commands/access.js');
        if (!action) throw new Error('Usage: elestio vscode <vmID>');
        await getVSCode(action, args.project, json);
        break;
      }

      case 'files': {
        const { getFileExplorer } = await import('./commands/access.js');
        if (!action) throw new Error('Usage: elestio files <vmID>');
        await getFileExplorer(action, args.project, json);
        break;
      }

      // ── Volumes ──

      case 'volumes': {
        const volumes = await import('./commands/volumes.js');
        switch (action) {
          case 'create':
            await volumes.createVolume({ name: args.name || args._[2], size: args.size ? parseInt(args.size) : undefined, provider: args.provider, datacenter: args.datacenter, projectId: args.project, serverId: args.server, storageType: args.type });
            break;
          case 'service-list':
            await volumes.getServiceVolumes(args._[2], json);
            break;
          case 'service-create':
            await volumes.createServiceVolume(args._[2], { name: args.name || args._[3], size: args.size ? parseInt(args.size) : undefined, storageType: args.type });
            break;
          case 'resize':
            await volumes.resizeVolume(args._[2], args._[3] || args.volume, parseInt(args.size || args._[4]));
            break;
          case 'detach':
            await volumes.detachVolume(args._[2], args._[3] || args.volume, { keepVolume: args.keep !== 'false' });
            break;
          case 'delete':
            await volumes.deleteServiceVolume(args._[2], args._[3] || args.volume);
            break;
          case 'protect':
            await volumes.setVolumeProtection(args._[2], args._[3] || args.volume, args.disable !== true);
            break;
          default:
            if (action && action !== 'list') {
              showHelp('volumes', {
                'list': 'List volumes in project (--project)',
                'create --name <n> --size <gb>': 'Create a standalone volume',
                'service-list <vmID>': 'List volumes attached to a service',
                'service-create <vmID> --name <n>': 'Create and attach a volume',
                'resize <vmID> <volumeID> --size <gb>': 'Resize a volume',
                'detach <vmID> <volumeID>': 'Detach a volume (--keep false to delete)',
                'delete <vmID> <volumeID>': 'Delete a volume',
                'protect <vmID> <volumeID>': 'Toggle volume protection (--disable)'
              });
            } else {
              await volumes.listVolumes(args.project, json);
            }
        }
        break;
      }

      // ── CI/CD ──

      case 'cicd': {
        const cicd = await import('./commands/cicd.js');
        switch (action) {
          case 'targets':
            await cicd.getCicdServices(args.project, json);
            break;
          case 'pipelines':
            await cicd.getServicePipelines(args._[2], args.project, json);
            break;
          case 'pipeline-info':
            await cicd.getPipelineDetails(args._[2], args._[3] || args.pipeline, args.project, json);
            break;
          case 'pipeline-restart':
            await cicd.restartPipeline(args._[2], args._[3] || args.pipeline, args.project);
            break;
          case 'pipeline-stop':
            await cicd.stopPipeline(args._[2], args._[3] || args.pipeline, args.project);
            break;
          case 'pipeline-delete':
            await cicd.deletePipeline(args._[2], args._[3] || args.pipeline, args.project, !!args.force);
            break;
          case 'pipeline-resync':
            await cicd.resyncPipeline(args._[2], args._[3] || args.pipeline, args.project);
            break;
          case 'pipeline-logs':
            await cicd.getPipelineLogs(args._[2], args._[3] || args.pipeline, args.project);
            break;
          case 'pipeline-history':
            await cicd.getPipelineHistory(args._[2], args._[3] || args.pipeline, args.project, json);
            break;
          case 'pipeline-log':
            await cicd.viewPipelineLog(args._[2], args.pipeline, args.file, args.project);
            break;
          case 'domains':
            await cicd.listPipelineDomains(args._[2], args._[3] || args.pipeline, args.project, json);
            break;
          case 'domain-add':
            await cicd.addPipelineDomain(args._[2], args.pipeline, args.domain || args._[3], args.project);
            break;
          case 'domain-remove':
            await cicd.removePipelineDomain(args._[2], args.pipeline, args.domain || args._[3], args.project);
            break;
          case 'create': {
            if (args.auto) {
              await cicd.autoCreatePipeline({
                project: args.project, target: args.target, name: args.name,
                mode: args.mode, repo: args.repo, branch: args.branch,
                authId: args['auth-id'], image: args.image, imageTag: args['image-tag'],
                buildDir: args['build-dir'], rootDir: args['root-dir'],
                framework: args.framework, buildCmd: args['build-cmd'],
                runCmd: args['run-cmd'], installCmd: args['install-cmd'],
                nodeVersion: args['node-version'], variables: args.variables
              });
            } else {
              await cicd.createPipeline(args._[2] || args.file);
            }
            break;
          }
          case 'template': {
            const template = cicd.generatePipelineTemplate(args._[2] || args.mode || 'docker');
            console.log(template);
            break;
          }
          case 'registries':
            await cicd.getDockerRegistries(args.project, json);
            break;
          case 'registry-add':
            await cicd.addDockerRegistry(args.project, args.name || args._[2], args.username || args._[3], args.password, args.url);
            break;
          default:
            showHelp('cicd', {
              'targets': 'List CI/CD targets',
              'pipelines <vmID>': 'List pipelines on a target',
              'pipeline-info <vmID> <pipelineID>': 'Show pipeline details',
              'pipeline-restart <vmID> <pipelineID>': 'Restart a pipeline',
              'pipeline-stop <vmID> <pipelineID>': 'Stop a pipeline',
              'pipeline-delete <vmID> <pipelineID>': 'Delete a pipeline (--force)',
              'pipeline-resync <vmID> <pipelineID>': 'Re-sync a pipeline',
              'pipeline-logs <vmID> <pipelineID>': 'View pipeline logs',
              'pipeline-history <vmID> <pipelineID>': 'View build history',
              'create --auto --target <vmID> --name <n>': 'Auto-create pipeline (--mode, --repo)',
              'create <config.json>': 'Create pipeline from config file',
              'template [mode]': 'Generate pipeline config template',
              'domains <vmID> <pipelineID>': 'List pipeline domains',
              'domain-add <vmID> --pipeline <id> --domain <d>': 'Add a domain',
              'domain-remove <vmID> --pipeline <id> --domain <d>': 'Remove a domain',
              'registries': 'List Docker registries',
              'registry-add --name <n> --username <u> --password <p> --url <url>': 'Add Docker registry'
            });
        }
        break;
      }

      // ── Billing ──

      case 'billing': {
        const billing = await import('./commands/billing.js');
        if (action === 'project') {
          await billing.getProjectBilling(args._[2] || args.project, json);
        } else {
          await billing.getBillingSummary(json);
        }
        break;
      }

      // ── Unknown ──

      default:
        log('error', `Unknown command: ${command}`);
        log('info', 'Run "elestio --help" for usage');
        process.exitCode = 1;
    }
  } catch (err) {
    log('error', err.message);
    if (args.debug) console.error(err);
    process.exitCode = 1;
  }
}
