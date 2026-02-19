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

| Command | Description |
|---------|-------------|
| `elestio cicd targets` | List CI/CD targets |
| `elestio cicd pipelines <vmID>` | List pipelines |
| `elestio cicd pipeline-info <vmID> <pipelineID>` | Pipeline details |
| `elestio cicd pipeline-restart <vmID> <pipelineID>` | Restart pipeline |
| `elestio cicd pipeline-stop <vmID> <pipelineID>` | Stop pipeline |
| `elestio cicd pipeline-delete <vmID> <pipelineID> --force` | Delete pipeline |
| `elestio cicd pipeline-resync <vmID> <pipelineID>` | Re-sync pipeline |
| `elestio cicd pipeline-logs <vmID> <pipelineID>` | View pipeline logs |
| `elestio cicd pipeline-history <vmID> <pipelineID>` | Build history |
| `elestio cicd create --auto --target <vmID> --name X --repo owner/repo` | Auto-create pipeline |
| `elestio cicd create <config.json>` | Create from config file |
| `elestio cicd template [mode]` | Generate config template |
| `elestio cicd domains <vmID> <pipelineID>` | List pipeline domains |
| `elestio cicd registries` | List Docker registries |
| `elestio cicd registry-add --name X --username U --password P --url URL` | Add registry |

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

## Configuration

Credentials and config are stored in `~/.elestio/`:

- `~/.elestio/credentials` - Email and API token (mode 0600)
- `~/.elestio/config.json` - JWT cache, default project, provider defaults

Get your API token from [Elestio Dashboard > Security](https://dash.elest.io/account/security).

## License

MIT
