const CLOUD_INIT_HEADER = '#cloud-config';
const RUNNER_ENV_PATH = '/etc/shipfox/runner.env';
const RUNNER_ENV_TEMP_PATH = '/etc/shipfox/runner.env.tmp';
const RUNNER_WORKSPACE_ROOT = '/var/lib/shipfox/workspaces';

const WORKSPACE_MOUNT_SCRIPT = `set -eu
workspace_root='${RUNNER_WORKSPACE_ROOT}'
install -d -o shipfox -g shipfox "$workspace_root"

# Nitro instances expose EBS volumes as NVMe devices rather than the names used
# in the EC2 block-device mapping. Exclude the disk containing / and use the
# remaining disk, which is the empty workspace volume attached by the provider.
root_source="$(findmnt -n -o SOURCE /)"
root_disk="$(lsblk -ndo PKNAME "$root_source" || true)"
if [ -z "$root_disk" ]; then
  root_disk="$(lsblk -ndo NAME "$root_source")"
fi
if [ -z "$root_disk" ]; then
  echo 'Unable to identify the root disk.' >&2
  exit 1
fi

workspace_device=''
for candidate in $(lsblk -dnro NAME,TYPE | awk '$2 == "disk" {print "/dev/" $1}'); do
  if [ "$candidate" = "/dev/$root_disk" ]; then
    continue
  fi
  model="$(cat "/sys/class/block/$(basename "$candidate")/device/model" 2>/dev/null || true)"
  case "$model" in
    *'Amazon EC2 NVMe Instance Storage'*) continue ;;
  esac
  workspace_device="$candidate"
  break
done
if [ -z "$workspace_device" ]; then
  echo 'Unable to find the EC2 workspace disk.' >&2
  exit 1
fi

if ! blkid "$workspace_device" >/dev/null 2>&1; then
  mkfs.ext4 -F -L shipfox-workspace "$workspace_device"
fi
workspace_uuid="$(blkid -s UUID -o value "$workspace_device")"
if [ -z "$workspace_uuid" ]; then
  echo 'The EC2 workspace disk has no filesystem UUID.' >&2
  exit 1
fi
if ! grep -Fq " $workspace_root " /etc/fstab; then
  printf 'UUID=%s %s auto defaults,nofail 0 0\\n' "$workspace_uuid" "$workspace_root" >> /etc/fstab
fi
if ! mountpoint -q "$workspace_root"; then
  mount "$workspace_device" "$workspace_root"
fi
chown shipfox:shipfox "$workspace_root"`;

/** Values written into the runner image environment file at EC2 boot. */
export interface RunnerBootstrapUserDataOptions {
  readonly apiUrl: string;
  readonly bootstrapToken: string;
  readonly labels: readonly string[];
  readonly pollMaxDurationMs: number;
  readonly maxLifetimeSeconds: number;
  readonly providerKind?: string;
  readonly protocolVersion?: string;
}

/** A safe-to-log summary of rendered user data. It intentionally omits credentials and contents. */
export interface RedactedRunnerBootstrapUserData {
  readonly envPath: string;
  readonly labels: readonly string[];
  readonly providerKind: string;
  readonly protocolVersion: string;
  readonly workspaceRoot: string;
  readonly pollMaxDurationMs: number;
  readonly maxLifetimeSeconds: number;
}

interface RunnerBootstrapEnvironment {
  readonly SHIPFOX_API_URL: string;
  readonly SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: string;
  readonly SHIPFOX_RUNNER_PROVIDER_KIND: string;
  readonly SHIPFOX_RUNNER_PROTOCOL_VERSION: string;
  readonly SHIPFOX_RUNNER_LABELS: string;
  readonly SHIPFOX_RUNNER_WORKSPACE_ROOT: string;
  readonly SHIPFOX_POLL_MAX_DURATION_MS: string;
  readonly SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: string;
}

/**
 * Renders the cloud-init configuration consumed by the prebaked Shipfox runner image.
 * Cloud-init stages the file under a temporary path and atomically renames it into place;
 * the image's path unit starts the lifecycle target when the final path appears. No
 * workspace-scoped credential is included.
 */
export function renderRunnerBootstrapUserData(options: RunnerBootstrapUserDataOptions): string {
  const environment = runnerBootstrapEnvironment(options);
  const envFile = Object.entries(environment)
    .map(([key, value]) => `${key}=${escapeEnvironmentValue(value)}`)
    .join('\n');

  return `${CLOUD_INIT_HEADER}
write_files:
  - path: ${RUNNER_ENV_TEMP_PATH}
    owner: root:root
    permissions: '0600'
    content: |
${indent(envFile, 6)}
runcmd:
  - |
${indent(WORKSPACE_MOUNT_SCRIPT, 6)}
  - ['/usr/bin/mv', '--', ${RUNNER_ENV_TEMP_PATH}, ${RUNNER_ENV_PATH}]
`;
}

/** Returns only non-sensitive metadata suitable for structured launch logs. */
export function redactRunnerBootstrapUserData(
  options: RunnerBootstrapUserDataOptions,
): RedactedRunnerBootstrapUserData {
  const environment = runnerBootstrapEnvironment(options);
  return {
    envPath: RUNNER_ENV_PATH,
    labels: options.labels,
    providerKind: environment.SHIPFOX_RUNNER_PROVIDER_KIND,
    protocolVersion: environment.SHIPFOX_RUNNER_PROTOCOL_VERSION,
    workspaceRoot: environment.SHIPFOX_RUNNER_WORKSPACE_ROOT,
    pollMaxDurationMs: options.pollMaxDurationMs,
    maxLifetimeSeconds: options.maxLifetimeSeconds,
  };
}

function runnerBootstrapEnvironment(
  options: RunnerBootstrapUserDataOptions,
): RunnerBootstrapEnvironment {
  const providerKind = options.providerKind ?? 'ec2';
  const protocolVersion = options.protocolVersion ?? '1';
  const values = {
    SHIPFOX_API_URL: options.apiUrl,
    SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: options.bootstrapToken,
    SHIPFOX_RUNNER_PROVIDER_KIND: providerKind,
    SHIPFOX_RUNNER_PROTOCOL_VERSION: protocolVersion,
    SHIPFOX_RUNNER_LABELS: options.labels.join(','),
    SHIPFOX_RUNNER_WORKSPACE_ROOT: RUNNER_WORKSPACE_ROOT,
    SHIPFOX_POLL_MAX_DURATION_MS: String(options.pollMaxDurationMs),
    SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: String(options.maxLifetimeSeconds),
  };

  for (const [key, value] of Object.entries(values)) {
    if (value.length === 0) throw new Error(`${key} must not be empty.`);
    if (value.includes('\n') || value.includes('\r'))
      throw new Error(`${key} must not contain a line break.`);
  }
  if (!Number.isInteger(options.pollMaxDurationMs) || options.pollMaxDurationMs < 0)
    throw new Error('pollMaxDurationMs must be a non-negative integer.');
  if (!Number.isInteger(options.maxLifetimeSeconds) || options.maxLifetimeSeconds <= 0)
    throw new Error('maxLifetimeSeconds must be a positive integer.');

  return values;
}

function escapeEnvironmentValue(value: string): string {
  return JSON.stringify(value);
}

function indent(value: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return value
    .split('\n')
    .map((line) => (line.length === 0 ? line : `${padding}${line}`))
    .join('\n');
}
