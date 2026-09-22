# Elestio CLI

Deploy and manage services on the [Elestio](https://elest.io) DevOps platform from the command line.

## Installation

```bash
npm install -g elestio
```

Requires Node.js >= 18.

## Quick Start

```bash
# Configure credentials (get your API token from https://dash.elest.io/account/security)
elestio login --email you@example.com --token YOUR_API_TOKEN

# Verify authentication
elestio auth test

# List available templates
elestio templates

# Deploy a service
elestio deploy PostgreSQL --project 12345 --name my-db

# List services
elestio services --project 12345
```

### Three ways to run software

| | Command | You get |
|---|---|---|
| **Managed service** | `elestio deploy postgresql` | One VM running the software, fully managed |
| **Cluster** | `elestio deploy postgresql --cluster --nodes 3` | Several VMs with replication |
| **Pipeline** | `elestio cicd deploy-template n8n --target <vmID>` | Software running on a shared CI/CD target, rebuilt from a repo |

Pipelines are cheaper (several pipelines share one target VM) and let you edit
the software's compose file; managed services get backups, monitoring and
support. See [CI/CD](#cicd) for the pipeline route.

## Commands

### Auth & Config

| Command | Description |
|---------|-------------|
| `elestio login --email X --token Y` | Configure credentials |
| `elestio whoami` | Show current user |
| `elestio config` | Show current configuration |
| `elestio config --set-default-project ID` | Set default project |
| `elestio config --provider X --datacenter Y` | Set defaults |
| `elestio auth test` | Test authentication |

### Catalog (no auth required)

| Command | Description |
|---------|-------------|
| `elestio templates` | List all 400+ deployable templates |
| `elestio templates search <query>` | Search templates |
| `elestio templates info <name>` | Show template details |
| `elestio categories` | List template categories |
| `elestio sizes` | List server sizes and pricing |
| `elestio sizes --provider hetzner` | Filter by provider |

### Projects

| Command | Description |
|---------|-------------|
| `elestio projects` | List all projects |
| `elestio projects create <name>` | Create a project |
| `elestio projects edit <id> --name X` | Edit a project |
| `elestio projects delete <id> --force` | Delete a project |
| `elestio projects members <id>` | List members |
| `elestio projects add-member <id> <email>` | Add a member |
| `elestio projects remove-member <id> <memberId>` | Remove a member |

### Services

| Command | Description |
|---------|-------------|
| `elestio services` | List services in default project |
| `elestio service <vmID>` | Show service details |
| `elestio deploy <template>` | Deploy a new service |
| `elestio deploy <template> --cluster` | Deploy as a cluster (see [Clusters](#clusters)) |
| `elestio deploy <template> --dry-run` | Preview deployment |
| `elestio delete-service <vmID> --force` | Delete a service |
| `elestio move-service <vmID> <targetProjectId>` | Move to another project |
| `elestio wait <vmID>` | Wait for deployment to complete |

#### Deploy options

```bash
elestio deploy PostgreSQL \
  --project 12345 \
  --name my-db \
  --provider hetzner \
  --region fsn1 \
  --size MEDIUM-2C-4G \
  --version 16 \
  --support level1
```

### Clusters

Clustering is available for 19 templates - PostgreSQL, MySQL, Redis, ClickHouse,
RabbitMQ, OpenSearch, Keycloak and others. Run `elestio clusters templates` for
the current list, which is read from the catalog rather than hardcoded.

```bash
# What can be clustered, and each one's minimum node count
elestio clusters templates

# 1 primary + 2 replicas. Always check the VM count first: billing is per VM.
elestio deploy postgresql --cluster --nodes 3 --dry-run
elestio deploy postgresql --cluster --nodes 3

# MySQL is the only software that supports writes on several nodes
elestio deploy mysql --cluster --cluster-mode multi-master
```

| Option | Description |
|--------|-------------|
| `--cluster` | Deploy a cluster instead of a single node |
| `--nodes <n>` | **Total** nodes, primary included. Defaults to the template minimum, caps at 15 |
| `--cluster-mode <mode>` | `primary-replica` (default) or `multi-master` |

`--nodes 3` means 1 primary and 2 replicas, and bills 3 VMs.

ClickHouse, Vault, OpenSearch, RabbitMQ, rke2 and Nats elect a leader by
quorum and need at least 3 nodes; everything else starts at 2. The CLI checks
this before calling the API, because a cluster the API rejects has often
already started billing its VMs.

| Command | Description |
|---------|-------------|
| `elestio clusters` | List clusters in the project |
| `elestio clusters info <clusterID>` | Cluster details and its nodes |
| `elestio clusters nodes <clusterID>` | List the active nodes |
| `elestio clusters templates` | Software that supports clustering |
| `elestio clusters promote <clusterID> <vmID> --force` | Promote a replica to primary |
| `elestio clusters failover <clusterID> --force` | Trigger a failover |
| `elestio clusters resync <clusterID> --force` | Re-sync replicas from the primary |
| `elestio clusters lock <clusterID>` | Enable termination protection |
| `elestio clusters unlock <clusterID>` | Disable termination protection |

`promote`, `failover` and `resync` all require `--force`: promotion demotes the
current primary, and re-sync **erases all data on the replicas** and replaces
it with a copy of the primary.

### Server Actions

| Command | Description |
|---------|-------------|
| `elestio reboot <vmID>` | Graceful reboot |
| `elestio reset <vmID>` | Hard reset |
| `elestio shutdown <vmID>` | Graceful shutdown |
| `elestio poweroff <vmID>` | Force power off |
| `elestio poweron <vmID>` | Power on |
| `elestio restart-stack <vmID>` | Restart Docker stack |
| `elestio lock <vmID>` | Enable termination protection |
| `elestio unlock <vmID>` | Disable termination protection |
| `elestio resize <vmID> --size LARGE-4C-8G` | Resize a VM |
| `elestio change-version <vmID> <version>` | Change software version |

### Firewall

| Command | Description |
|---------|-------------|
| `elestio firewall get <vmID>` | Show firewall rules |
| `elestio firewall enable <vmID> --rules '[...]'` | Enable firewall |
| `elestio firewall update <vmID> --rules '[...]'` | Update rules |
| `elestio firewall disable <vmID>` | Disable firewall |

### SSL / Custom Domains

| Command | Description |
|---------|-------------|
| `elestio ssl list <vmID>` | List custom domains |
| `elestio ssl add <vmID> <domain>` | Add domain with auto-SSL |
| `elestio ssl remove <vmID> <domain>` | Remove domain |

### SSH Keys

| Command | Description |
|---------|-------------|
| `elestio ssh-keys list <vmID>` | List SSH keys |
| `elestio ssh-keys add <vmID> --name X --key Y` | Add an SSH key |
| `elestio ssh-keys remove <vmID> --name X` | Remove an SSH key |

### Auto-Updates

| Command | Description |
|---------|-------------|
| `elestio updates system-enable <vmID>` | Enable OS auto-updates |
| `elestio updates system-disable <vmID>` | Disable OS auto-updates |
| `elestio updates system-now <vmID>` | Run OS update now |
| `elestio updates app-enable <vmID>` | Enable app auto-updates |
| `elestio updates app-disable <vmID>` | Disable app auto-updates |
| `elestio updates app-now <vmID>` | Run app update now |

### Alerts

| Command | Description |
|---------|-------------|
| `elestio alerts get <vmID>` | Show alert rules |
| `elestio alerts enable <vmID> --rules '...'` | Enable/update alerts |
| `elestio alerts disable <vmID>` | Disable alerts |

### Backups

| Command | Description |
|---------|-------------|
| `elestio backups local-list <vmID>` | List local backups |
| `elestio backups local-take <vmID>` | Take a local backup |
| `elestio backups local-restore <vmID> <path>` | Restore local backup |
| `elestio backups local-delete <vmID> <path>` | Delete local backup |
| `elestio backups remote-list <vmID>` | List remote backups |
| `elestio backups remote-take <vmID>` | Take remote backup |
| `elestio backups remote-restore <vmID> <snapshot>` | Restore remote backup |
| `elestio backups auto-enable <vmID>` | Setup auto backups |
| `elestio backups auto-disable <vmID>` | Disable auto backups |

### Snapshots

| Command | Description |
|---------|-------------|
| `elestio snapshots list <vmID>` | List snapshots |
| `elestio snapshots take <vmID>` | Take a snapshot |
| `elestio snapshots restore <vmID> <orderID>` | Restore (0 = most recent) |
| `elestio snapshots delete <vmID> <snapshotID>` | Delete a snapshot |
| `elestio snapshots auto-enable <vmID>` | Enable auto snapshots |
| `elestio snapshots auto-disable <vmID>` | Disable auto snapshots |

### S3 External Backups

| Command | Description |
|---------|-------------|
| `elestio s3-backup verify <vmID>` | Verify S3 config |
| `elestio s3-backup enable <vmID>` | Enable S3 backup |
| `elestio s3-backup disable <vmID>` | Disable S3 backup |
| `elestio s3-backup take <vmID>` | Take S3 backup |
| `elestio s3-backup list <vmID>` | List S3 backups |
| `elestio s3-backup restore <vmID> <key>` | Restore S3 backup |
| `elestio s3-backup delete <vmID> <key>` | Delete S3 backup |

S3 options: `--key`, `--secret`, `--bucket`, `--endpoint`, `--prefix`

### Access

| Command | Description |
|---------|-------------|
| `elestio credentials <vmID>` | Get app URL, user & password |
| `elestio ssh <vmID>` | Get web terminal URL |
| `elestio ssh <vmID> --direct` | Get direct SSH connection info |
| `elestio vscode <vmID>` | Get VSCode web URL |
| `elestio files <vmID>` | Get file explorer URL |

### Volumes

| Command | Description |
|---------|-------------|
| `elestio volumes` | List project volumes |
| `elestio volumes create --name X --size 10` | Create a volume |
| `elestio volumes service-list <vmID>` | List attached volumes |
| `elestio volumes service-create <vmID> --name X` | Create & attach volume |
| `elestio volumes resize <vmID> <volumeID> --size 50` | Resize a volume |
| `elestio volumes detach <vmID> <volumeID>` | Detach a volume |
| `elestio volumes delete <vmID> <volumeID>` | Delete a volume |
| `elestio volumes protect <vmID> <volumeID>` | Toggle protection |

### CI/CD

There are two very different things you can put on a CI/CD target, and picking
the wrong one is the usual reason a pipeline comes up empty:

| You want to run | Use | Why |
|---|---|---|
| Software from the Elestio catalog (n8n, Rybbit, Plausible...) | `cicd deploy-template` | Reads the template's `elestio.yml` for ports, env vars and lifecycle hooks |
| Your own application from your own repo | `cicd create --auto` | You supply the build and run commands |

#### Deploying catalog software as a pipeline

```bash
# 1. Create a CI/CD target if you do not have one (this is a VM)
elestio deploy CI-CD-Target --name my-target

# 2. Find the software
elestio cicd templates n8n

# 3. See exactly what will be created, without creating it
elestio cicd deploy-template n8n --target <vmID> --no-git --dry-run

# 4. Deploy
elestio cicd deploy-template n8n --target <vmID> --owner my-github-user
```

Every catalog entry has a companion repo at
`github.com/elestio-examples/<software>` containing a `docker-compose.yml` and
an `elestio.yml`. The `elestio.yml` is what makes the software actually run:

```yaml
config:       { runTime, version, buildCommand, runCommand, buildDir }
environments: [{ key, value }]     # becomes the pipeline's env vars
ports:        [{ protocol, targetPort, public, path }]
lifeCycleConfig: { preInstallCommand, postInstallCommand, ... }
webUI:        [{ url, label, login, password }]   # credentials printed on success
```

`deploy-template` reads that file and builds the pipeline from it. Passwords
written as `random_password` are generated, `[EMAIL]` becomes your account
email, and `[CI_CD_DOMAIN]` is resolved by the platform once the pipeline has a
domain.

**Two routes:**

| | `--owner <git-user>` (default) | `--no-git` |
|---|---|---|
| What it does | Generates the template repo into your Git account, then builds from it | Inlines the template's `docker-compose.yml` |
| Needs a Git account | Yes, connected in the dashboard | No |
| Lifecycle scripts | Run | **Skipped** |
| Good for | Software with `preInstall`/`postInstall` hooks; when you want to edit the code | Quick deployments, automation, agents |

The CLI warns you when you use `--no-git` on a template that declares lifecycle
scripts, because that software will probably fail to start.

| Command | Description |
|---------|-------------|
| `elestio cicd templates [query]` | List catalog software deployable as a pipeline |
| `elestio cicd deploy-template <software> --target <vmID>` | Deploy catalog software as a pipeline |
| `elestio cicd targets` | List CI/CD targets |
| `elestio cicd pipelines <vmID>` | List pipelines |
| `elestio cicd pipeline-info <vmID> <pipelineID>` | Pipeline details |
| `elestio cicd pipeline-restart <vmID> <pipelineID>` | Restart pipeline |
| `elestio cicd pipeline-stop <vmID> <pipelineID>` | Stop pipeline |
| `elestio cicd pipeline-delete <vmID> <pipelineID> --force` | Delete pipeline |
| `elestio cicd pipeline-resync <vmID> <pipelineID>` | Re-sync pipeline |
| `elestio cicd pipeline-logs <vmID> <pipelineID>` | View pipeline logs |
| `elestio cicd pipeline-history <vmID> <pipelineID>` | Build history |
| `elestio cicd create --auto --target <vmID> --name X --repo owner/repo` | Pipeline from your own repo |
| `elestio cicd create <config.json>` | Create from config file |
| `elestio cicd template [mode]` | Generate config template |
| `elestio cicd domains <vmID> <pipelineID>` | List pipeline domains |
| `elestio cicd registries` | List Docker registries |

**`deploy-template` options:**

| Option | Description |
|--------|-------------|
| `--target <vmID>` | **Required.** CI/CD target to deploy onto (`elestio cicd targets`) |
| `--owner <user-or-org>` | Git account or org to create the repo in. Required unless `--no-git` |
| `--no-git` | Skip repo creation, inline the compose file instead |
| `--name <name>` | Pipeline name (defaults to the software name) |
| `--branch <branch>` | Template branch (default `main`) |
| `--private` | Create the generated repo as private |
| `--non-org` | The owner is a personal account, not an organisation |
| `--auth-id <id>` | Git auth ID, when you have more than one account connected |
| `--git-type <type>` | `GITHUB` (default) or `GITLAB` |
| `--dry-run` | Print the plan, create nothing |

#### Pipelines from your own repository

```bash
elestio cicd create --auto --target <vmID> --name my-app --repo acme/my-app \
  --mode github --build-cmd "npm run build" --run-cmd "npm start"
```

Modes: `github`, `github-fullstack`, `gitlab`, `gitlab-fullstack`, `docker`.

#### Docker registries

| Command | Description |
|---------|-------------|
| `elestio cicd registry-add --name X --username U --password P --url REPO` | Docker Hub |
| `... --registry-type registry.gitlab.com --repo-id ID` | GitLab.com |
| `... --registry-type gitlab-self-hosted --repo-id ID --gitlab-url gitlab.company.com` | Self-hosted GitLab |
| `... --registry-type ghcr.io` | GitHub Container Registry |

| Option | Description |
|--------|-------------|
| `--name` | Unique identity nickname for the registry credential |
| `--username` | Registry username |
| `--password` | Registry password or access token |
| `--url` | Repository path (e.g. `myuser/myrepo`) - **not** the registry host |
| `--registry-type` | `docker.io` (default), `registry.gitlab.com`, `gitlab-self-hosted`, `ghcr.io` |
| `--repo-id` | GitLab project/repo ID - required for both GitLab types |
| `--gitlab-url` | Self-hosted GitLab hostname - required for `gitlab-self-hosted` |

### Billing

| Command | Description |
|---------|-------------|
| `elestio billing` | Billing summary across all projects |
| `elestio billing project <id>` | Per-project billing details |

## Global Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format (for scripting) |
| `--project <id>` | Specify project ID |
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show version |
| `--debug` | Show full error stack traces |

### Passing values that start with `-`

`--flag value` treats a value like `-p` or `--port` as the next flag. For any
value that begins with a dash - passwords, negative numbers - use the
`--flag=value` form instead:

```bash
elestio cicd registry-add --name ghcr --username me --password='-Xk9secret'
```

Everything after a bare `--` is treated as a positional argument.

## Configuration

Credentials and config are stored in `~/.elestio/` (directory mode 0700):

- `~/.elestio/credentials` - Email and API token (mode 0600)
- `~/.elestio/config.json` - JWT cache, default project, provider defaults (mode 0600; the cached JWT is a bearer credential)

Requests to the API time out after 60s rather than hanging.

Get your API token from [Elestio Dashboard > Security](https://dash.elest.io/account/security).

## Troubleshooting

**My pipeline deployed but nothing is running.**
The pipeline was created without the template's configuration. Use
`elestio cicd deploy-template <software>` rather than `cicd create` for catalog
software: it reads the template's `elestio.yml` for ports, environment
variables and lifecycle hooks. `cicd create` builds a bare pipeline and expects
you to supply all of that yourself.

**The software starts, then exits.**
If you deployed with `--no-git`, the template's `preInstall`/`postInstall`
scripts were skipped because there is no repo checkout. Re-deploy with the Git
route (`--owner <your-git-user>`). `--dry-run` lists the lifecycle hooks a
template declares.

**`variables.trim is not a function` (500 Pipeline.CreateFailed).**
The `variables` field must be a newline-separated string, never an array. The
CLI enforces this from 1.0.4; if you are on an older version, upgrade with
`npm install -g elestio@latest`.

**`does not support clustering`.**
Only some templates can be clustered. Run `elestio clusters templates` for the
current list.

**`needs at least 3 nodes`.**
ClickHouse, Vault, OpenSearch, RabbitMQ, rke2 and Nats elect a leader by
quorum and cannot run on two nodes.

**Authentication keeps failing.**
API tokens can be revoked or expire. Get a new one from
[Dashboard > Security](https://dash.elest.io/account/security) and re-run
`elestio login`. Check what is stored with `elestio config`.

**A value starting with `-` is ignored.**
Use `--flag=value`. See [Global Options](#global-options).

## Documentation 
   https://docs.elest.io/books/elestio-cli-skill/page/overview
## License

MIT
