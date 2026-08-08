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
      SHIPFOX_POLL_MAX_DURATION_MS="300000"
      SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"
runcmd:
  - |
      set -eu
      workspace_root='/var/lib/shipfox/workspaces'
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
      chown shipfox:shipfox "$workspace_root"
  - ['/usr/bin/mv', '--', /etc/shipfox/runner.env.tmp, /etc/shipfox/runner.env]
`);
  });

  it('does not render workspace-scoped registration material', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).not.toContain('SHIPFOX_RUNNER_REGISTRATION_TOKEN');
    expect(userData).not.toContain('WORKSPACE_ID');
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
