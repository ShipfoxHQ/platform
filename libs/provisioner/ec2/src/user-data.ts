const CLOUD_INIT_HEADER = '#cloud-config';
const RUNNER_ENV_PATH = '/etc/shipfox/runner.env';
const RUNNER_ENV_TEMP_PATH = '/etc/shipfox/runner.env.tmp';
const RUNNER_WORKSPACE_ROOT = '/var/lib/shipfox/workspaces';
const WORKSPACE_MOUNT_UNIT = 'var-lib-shipfox-workspaces.mount';
const RUNNER_MOUNT_DROPIN_DIR = '/etc/systemd/system/shipfox-runner.service.d';
const WORKSPACE_FS_LABEL = 'shipfox-workspc';
const EC2_DEVICE_NAME_PATTERN = /^\/dev\/[A-Za-z0-9]+$/;

function workspaceMountScript(workspaceDeviceName: string): string {
  return String.raw`set -u
abort_boot() {
  printf '%s\n' "$1" >&2
  if ! systemctl poweroff --no-wall; then
    /sbin/poweroff -f || true
  fi
  exit 1
}

workspace_root='${RUNNER_WORKSPACE_ROOT}'
workspace_device_name='${workspaceDeviceName}'
workspace_mount_unit='${WORKSPACE_MOUNT_UNIT}'
workspace_mount_unit_path="/etc/systemd/system/$workspace_mount_unit"
runner_mount_dropin_dir='${RUNNER_MOUNT_DROPIN_DIR}'
runner_mount_dropin_path="$runner_mount_dropin_dir/10-shipfox-workspace.conf"
if ! install -d -o shipfox -g shipfox "$workspace_root"; then
  abort_boot "Unable to create the EC2 workspace directory at $workspace_root."
fi

# Xen exposes the configured mapping name directly. Nitro may expose the same
# EBS volume as an NVMe device, so resolve it by its EBS model when the mapping
# name is not present. Never guess when more than one non-root EBS disk exists.
workspace_device=''
if [ -b "$workspace_device_name" ]; then
  workspace_device_type="$(lsblk -ndo TYPE "$workspace_device_name" || true)"
  if [ "$workspace_device_type" != 'disk' ]; then
    abort_boot "Configured workspace device $workspace_device_name is not a disk."
  fi
  workspace_real_device="$(readlink -f "$workspace_device_name" 2>/dev/null || true)"
  if [ -z "$workspace_real_device" ]; then
    abort_boot "Unable to resolve configured workspace device $workspace_device_name."
  fi
  workspace_model="$(cat "/sys/class/block/$(basename "$workspace_real_device")/device/model" 2>/dev/null || true)"
  case "$workspace_model" in
    *'Amazon EC2 NVMe Instance Storage'*)
      abort_boot "Configured workspace device $workspace_device_name is instance storage."
      ;;
    *)
      workspace_device="$workspace_device_name"
      ;;
  esac
fi

root_source="$(findmnt -n -o SOURCE / 2>/dev/null || true)"
if [ -z "$root_source" ]; then
  abort_boot 'Unable to identify the root filesystem.'
fi
root_disk="$(lsblk -ndo PKNAME "$root_source" || true)"
if [ -z "$root_disk" ]; then
  root_disk="$(lsblk -ndo NAME "$root_source" || true)"
fi
if [ -z "$root_disk" ]; then
  abort_boot 'Unable to identify the root disk.'
fi
if [ -n "$workspace_device" ]; then
  workspace_disk="$(lsblk -ndo PKNAME "$workspace_device" || true)"
  if [ -z "$workspace_disk" ]; then
    workspace_disk="$(lsblk -ndo NAME "$workspace_device" || true)"
  fi
  if [ -z "$workspace_disk" ]; then
    abort_boot "Unable to identify the disk backing $workspace_device_name."
  fi
  if [ "$workspace_disk" = "$root_disk" ]; then
    abort_boot "Configured workspace device $workspace_device_name resolves to the root disk."
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
    abort_boot "Unable to uniquely resolve EC2 workspace device $workspace_device_name; found $workspace_candidate_count non-root EBS disks."
  fi
  workspace_device="$workspace_candidate"
fi

if [ -z "$workspace_device" ]; then
  abort_boot 'Unable to find the EC2 workspace disk.'
fi

if ! blkid "$workspace_device" >/dev/null 2>&1; then
  if ! mkfs.ext4 -F -E lazy_itable_init=1,lazy_journal_init=1 -L '${WORKSPACE_FS_LABEL}' "$workspace_device"; then
    abort_boot "Unable to format the EC2 workspace device $workspace_device."
  fi
fi
workspace_uuid="$(blkid -s UUID -o value "$workspace_device" 2>/dev/null || true)"
if [ -z "$workspace_uuid" ]; then
  abort_boot 'The EC2 workspace disk has no filesystem UUID.'
fi

# systemd owns the mount after boot. Write the unit only after the filesystem UUID
# exists so the unit and the EC2 device selection have one source of truth.
if ! printf '[Unit]\nDescription=Mount the Shipfox job workspace volume\n\n[Mount]\nWhat=UUID=%s\nWhere=%s\nType=ext4\nOptions=defaults,nofail\n\n[Install]\nWantedBy=multi-user.target\n' \
  "$workspace_uuid" "$workspace_root" > "$workspace_mount_unit_path"; then
  abort_boot "Unable to write the EC2 workspace mount unit at $workspace_mount_unit_path."
fi

# Keep the shared runner image provider-neutral. EC2 adds this boot-time dependency
# after writing the unit; QEMU never runs this EC2 bootstrap and receives no drop-in.
if ! mkdir -p "$runner_mount_dropin_dir"; then
  abort_boot "Unable to create the runner mount dependency directory at $runner_mount_dropin_dir."
fi
if ! printf '[Unit]\nRequires=%s\nAfter=%s\n' "$workspace_mount_unit" "$workspace_mount_unit" > "$runner_mount_dropin_path"; then
  abort_boot "Unable to write the runner mount dependency at $runner_mount_dropin_path."
fi

if ! systemctl daemon-reload; then
  abort_boot 'Unable to reload systemd after configuring the EC2 workspace mount.'
fi
if ! systemctl enable "$workspace_mount_unit"; then
  abort_boot "Unable to enable the EC2 workspace mount unit $workspace_mount_unit."
fi
if ! systemctl start "$workspace_mount_unit"; then
  abort_boot "Unable to start the EC2 workspace mount unit $workspace_mount_unit."
fi
if ! mountpoint -q "$workspace_root"; then
  abort_boot "The EC2 workspace volume did not mount at $workspace_root."
fi
if ! chown shipfox:shipfox "$workspace_root"; then
  abort_boot "Unable to assign ownership of the EC2 workspace directory at $workspace_root."
fi
if ! /usr/bin/mv -- '${RUNNER_ENV_TEMP_PATH}' '${RUNNER_ENV_PATH}'; then
  abort_boot 'Unable to publish the runner environment after the EC2 workspace mounted.'
fi
`;
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
