import {execFileSync} from 'node:child_process';

import {
  type RunnerBootstrapUserDataOptions,
  redactRunnerBootstrapUserData,
  renderRunnerBootstrapUserData,
} from '#user-data.js';

const options: RunnerBootstrapUserDataOptions = {
  apiUrl: 'https://api.shipfox.test',
  bootstrapToken: 'sf_rbt_sensitive-bootstrap-token',
  labels: ['linux', 'x64', 'self-hosted'],
  pollMaxDurationMs: 300_000,
  maxLifetimeSeconds: 3600,
  workspaceDeviceName: '/dev/sdf',
};

describe('renderRunnerBootstrapUserData', () => {
  it('atomically publishes the managed runner environment contract for cloud-init', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).toBe(`#cloud-config
write_files:
  - path: /etc/shipfox/runner.env.tmp
    owner: root:root
    permissions: '0600'
    content: |
      SHIPFOX_API_URL="https://api.shipfox.test"
      SHIPFOX_RUNNER_BOOTSTRAP_TOKEN="sf_rbt_sensitive-bootstrap-token"
      SHIPFOX_RUNNER_PROVIDER_KIND="ec2"
      SHIPFOX_RUNNER_PROTOCOL_VERSION="1"
      SHIPFOX_RUNNER_LABELS="linux,x64,self-hosted"
      SHIPFOX_RUNNER_WORKSPACE_ROOT="/var/lib/shipfox/workspaces"
      SHIPFOX_RUNNER_WORKSPACE_MOUNT_REQUIRED="1"
      SHIPFOX_POLL_MAX_DURATION_MS="300000"
      SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"
runcmd:
  - |
      set -eu
      workspace_root='/var/lib/shipfox/workspaces'
      workspace_device_name='/dev/sdf'
      install -d -o shipfox -g shipfox "$workspace_root"

      # Xen exposes the configured mapping name directly. Nitro may expose the same
      # EBS volume as an NVMe device, so resolve it by its EBS model when the mapping
      # name is not present. Never guess when more than one non-root EBS disk exists.
      workspace_device=''
      if [ -b "$workspace_device_name" ]; then
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

      workspace_mapping_tool_available=false
      if command -v ebsnvme-id >/dev/null 2>&1; then
        workspace_mapping_tool_available=true
      fi

      if [ -z "$workspace_device" ]; then
        configured_device_name="$(printf '%s\\n' "$workspace_device_name" | sed 's#^/dev/##')"
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
            mapped_device_name="$(printf '%s\\n' "$mapped_device_name" | sed 's#^/dev/##')"
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
      chown shipfox:shipfox "$workspace_root"
  - ['/usr/bin/mv', '--', /etc/shipfox/runner.env.tmp, /etc/shipfox/runner.env]
`);
  });

  it('does not render workspace-scoped registration material', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).not.toContain('SHIPFOX_RUNNER_REGISTRATION_TOKEN');
    expect(userData).not.toContain('WORKSPACE_ID');
  });

  it('renders a workspace mount script accepted by POSIX sh', () => {
    const userData = renderRunnerBootstrapUserData(options);
    const marker = 'runcmd:\n  - |\n';
    const markerOffset = userData.indexOf(marker);
    const script = userData
      .slice(markerOffset + marker.length)
      .split('\n')
      .map((line) => (line.startsWith('      ') ? line.slice(6) : line))
      .join('\n');

    expect(markerOffset).toBeGreaterThanOrEqual(0);
    expect(() => execFileSync('sh', ['-n', '-c', script])).not.toThrow();
  });

  it('rejects unsafe environment values', () => {
    const invalidOptions = {...options, bootstrapToken: 'token\nWORKSPACE_ID=leaked'};

    expect(() => renderRunnerBootstrapUserData(invalidOptions)).toThrow(
      'SHIPFOX_RUNNER_BOOTSTRAP_TOKEN must not contain a line break.',
    );
  });
});

describe('redactRunnerBootstrapUserData', () => {
  it('keeps bootstrap material out of launch-log metadata', () => {
    const redacted = redactRunnerBootstrapUserData(options);

    expect(redacted).toEqual({
      envPath: '/etc/shipfox/runner.env',
      labels: ['linux', 'x64', 'self-hosted'],
      providerKind: 'ec2',
      protocolVersion: '1',
      workspaceRoot: '/var/lib/shipfox/workspaces',
      pollMaxDurationMs: 300_000,
      maxLifetimeSeconds: 3600,
    });
    expect(JSON.stringify(redacted)).not.toContain(options.bootstrapToken);
    expect(JSON.stringify(redacted)).not.toContain(options.apiUrl);
  });
});
