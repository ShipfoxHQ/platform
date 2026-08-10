const CLOUD_INIT_HEADER = '#cloud-config';
const RUNNER_ENV_PATH = '/etc/shipfox/runner.env';
const RUNNER_ENV_TEMP_PATH = '/etc/shipfox/runner.env.tmp';
const RUNNER_WORKSPACE_ROOT = '/var/lib/shipfox/workspaces';
const WORKSPACE_MOUNT_UNIT = 'var-lib-shipfox-workspaces.mount';
const WORKSPACE_MOUNT_DROPIN_DIR = `/etc/systemd/system/${WORKSPACE_MOUNT_UNIT}.d`;
const RUNNER_MOUNT_DROPIN_DIR = '/etc/systemd/system/shipfox-runner.service.d';
const WORKSPACE_FS_LABEL = 'shipfox-workspc';
const EC2_DEVICE_NAME_PATTERN = /^\/dev\/[A-Za-z0-9]+$/;

function workspaceMountScript(workspaceDeviceName: string): string {
  return String.raw`set -eu
workspace_root='${RUNNER_WORKSPACE_ROOT}'
workspace_device_name='${workspaceDeviceName}'
workspace_mount_unit='${WORKSPACE_MOUNT_UNIT}'
workspace_mount_dropin_dir='${WORKSPACE_MOUNT_DROPIN_DIR}'
workspace_mount_unit_path="/etc/systemd/system/$workspace_mount_unit"
runner_mount_dropin_dir='${RUNNER_MOUNT_DROPIN_DIR}'
runner_mount_dropin_path="$runner_mount_dropin_dir/10-shipfox-workspace.conf"
install -d -o shipfox -g shipfox "$workspace_root"

# Xen exposes the configured mapping name directly. Nitro may expose the same
# EBS volume as an NVMe device, so resolve it by its EBS model when the mapping
# name is not present. Never guess when more than one non-root EBS disk exists.
workspace_device=''
if [ -b "$workspace_device_name" ]; then
  workspace_device_type="$(lsblk -ndo TYPE "$workspace_device_name" || true)"
  if [ "$workspace_device_type" != 'disk' ]; then
    echo "Configured workspace device $workspace_device_name is not a disk." >&2
    exit 1
  fi
  workspace_real_device="$(readlink -f "$workspace_device_name")"
  workspace_model="$(cat "/sys/class/block/$(basename "$workspace_real_device")/device/model" 2>/dev/null || true)"
  case "$workspace_model" in
    *'Amazon EC2 NVMe Instance Storage'*)
      echo "Configured workspace device $workspace_device_name is instance storage." >&2
      exit 1
      ;;
    *)
      workspace_device="$workspace_device_name"
      ;;
  esac
fi

root_source="$(findmnt -n -o SOURCE /)"
root_disk="$(lsblk -ndo PKNAME "$root_source" || true)"
if [ -z "$root_disk" ]; then
  root_disk="$(lsblk -ndo NAME "$root_source")"
fi
if [ -z "$root_disk" ]; then
  echo 'Unable to identify the root disk.' >&2
  exit 1
fi
if [ -n "$workspace_device" ]; then
  workspace_disk="$(lsblk -ndo PKNAME "$workspace_device" || true)"
  if [ -z "$workspace_disk" ]; then
    workspace_disk="$(lsblk -ndo NAME "$workspace_device" || true)"
  fi
  if [ "$workspace_disk" = "$root_disk" ]; then
    echo "Configured workspace device $workspace_device_name resolves to the root disk." >&2
    exit 1
  fi
fi

workspace_mapping_tool_available=false
if command -v ebsnvme-id >/dev/null 2>&1; then
  workspace_mapping_tool_available=true
fi

if [ -z "$workspace_device" ]; then
  configured_device_name="$(printf '%s\n' "$workspace_device_name" | sed 's#^/dev/##')"
  workspace_candidate_count=0
  workspace_candidate=''
  for candidate in $(lsblk -dnro NAME,TYPE | awk '$2 == "disk" {print "/dev/" $1}'); do
    if [ "$candidate" = "/dev/$root_disk" ]; then
      continue
    fi
    model="$(cat "/sys/class/block/$(basename "$candidate")/device/model" 2>/dev/null || true)"
    if [ "$model" != 'Amazon Elastic Block Store' ]; then
      continue
    fi
    if [ "$workspace_mapping_tool_available" = true ]; then
      mapped_device_name="$(ebsnvme-id -b "$candidate" 2>/dev/null || true)"
      mapped_device_name="$(printf '%s\n' "$mapped_device_name" | sed 's#^/dev/##')"
      if [ "$mapped_device_name" != "$configured_device_name" ]; then
        continue
      fi
    fi
    workspace_candidate_count=$((workspace_candidate_count + 1))
    workspace_candidate="$candidate"
  done
  if [ "$workspace_candidate_count" -ne 1 ]; then
    echo "Unable to uniquely resolve EC2 workspace device $workspace_device_name; found $workspace_candidate_count non-root EBS disks." >&2
    exit 1
  fi
  workspace_device="$workspace_candidate"
fi

if [ -z "$workspace_device" ]; then
  echo 'Unable to find the EC2 workspace disk.' >&2
  exit 1
fi

if ! blkid "$workspace_device" >/dev/null 2>&1; then
  mkfs.ext4 -F -E lazy_itable_init=1,lazy_journal_init=1 -L '${WORKSPACE_FS_LABEL}' "$workspace_device"
fi
workspace_uuid="$(blkid -s UUID -o value "$workspace_device")"
if [ -z "$workspace_uuid" ]; then
  echo 'The EC2 workspace disk has no filesystem UUID.' >&2
  exit 1
fi
if ! grep -Fq " $workspace_root " /etc/fstab; then
  printf 'UUID=%s %s auto defaults,nofail 0 0\n' "$workspace_uuid" "$workspace_root" >> /etc/fstab
fi

# Keep the shared runner image provider-neutral. EC2 adds this boot-time dependency
# only after the image's standalone mount unit is available; QEMU and older AMIs use
# the direct-mount fallback below and never receive this drop-in.
if [ -f "$workspace_mount_unit_path" ]; then
  mkdir -p "$runner_mount_dropin_dir"
  printf '[Unit]\nRequires=%s\nAfter=%s\n' "$workspace_mount_unit" "$workspace_mount_unit" > "$runner_mount_dropin_path"
fi

# Keep formatting in the EC2 boot sequence and mounting in systemd. The image ships
# a standalone mount unit; its UUID is filled in here after the volume is formatted.
# Older images do not have that unit, so retain the direct-mount path during migration.
mkdir -p "$workspace_mount_dropin_dir"
printf '[Mount]\nWhat=UUID=%s\n' "$workspace_uuid" > "$workspace_mount_dropin_dir/10-shipfox-workspace.conf"
systemctl daemon-reload
if [ -f "$workspace_mount_unit_path" ] && \
  systemctl enable "$workspace_mount_unit" && systemctl start "$workspace_mount_unit"; then
  :
else
  if ! mountpoint -q "$workspace_root"; then
    mount "$workspace_device" "$workspace_root"
  fi
fi
if ! mountpoint -q "$workspace_root"; then
  echo "The EC2 workspace volume did not mount at $workspace_root." >&2
  exit 1
fi
chown shipfox:shipfox "$workspace_root"
/usr/bin/mv -- '${RUNNER_ENV_TEMP_PATH}' '${RUNNER_ENV_PATH}'`;
}

/** Values written into the runner image environment file at EC2 boot. */
export interface RunnerBootstrapUserDataOptions {
  readonly apiUrl: string;
  readonly bootstrapToken: string;
  readonly labels: readonly string[];
  readonly pollMaxDurationMs: number;
  readonly maxLifetimeSeconds: number;
  readonly workspaceDeviceName: string;
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
 * workspace-scoped credential is included. The environment is published only after the
 * EC2 workspace volume has been formatted and mounted, so the runner only ever receives a
 * usable workspace directory and remains independent of storage implementation details.
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
${indent(workspaceMountScript(options.workspaceDeviceName), 6)}
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
  if (!EC2_DEVICE_NAME_PATTERN.test(options.workspaceDeviceName))
    throw new Error('workspaceDeviceName must be an EC2 device name like /dev/sdf.');

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
