import {execFileSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
  it('publishes the runner environment only after boot-owned workspace setup', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).toContain(`write_files:
  - path: /etc/shipfox/runner.env.tmp
    owner: root:root
    permissions: '0600'
    content: |`);
    for (const line of [
      'SHIPFOX_API_URL="https://api.shipfox.test"',
      'SHIPFOX_RUNNER_BOOTSTRAP_TOKEN="sf_rbt_sensitive-bootstrap-token"',
      'SHIPFOX_RUNNER_PROVIDER_KIND="ec2"',
      'SHIPFOX_RUNNER_PROTOCOL_VERSION="1"',
      'SHIPFOX_RUNNER_LABELS="linux,x64,self-hosted"',
      'SHIPFOX_RUNNER_WORKSPACE_ROOT="/var/lib/shipfox/workspaces"',
      'SHIPFOX_POLL_MAX_DURATION_MS="300000"',
      'SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"',
    ]) {
      expect(userData).toContain(`      ${line}`);
    }
    expect(userData).toContain("workspace_mount_unit='var-lib-shipfox-workspaces.mount'");
    expect(userData).toContain('abort_boot()');
    expect(userData).toContain('systemctl poweroff --no-wall');
    expect(userData).toContain(
      "printf '[Unit]\\nDescription=Mount the Shipfox job workspace volume",
    );
    expect(userData).toContain(
      `printf '[Unit]\\nRequires=%s\\nAfter=%s\\n' "$workspace_mount_unit"`,
    );
    expect(userData).not.toContain('/etc/fstab');
    expect(userData).not.toContain('SHIPFOX_RUNNER_WORKSPACE_MOUNT_REQUIRED');
    expect(userData).not.toContain('mount "$workspace_device"');
    expect(userData.indexOf('systemctl start "$workspace_mount_unit"')).toBeLessThan(
      userData.indexOf('/usr/bin/mv --'),
    );
    expect(userData).toContain("if ! /usr/bin/mv -- '/etc/shipfox/runner.env.tmp'");
  });

  it('does not render workspace-scoped registration material', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).not.toContain('SHIPFOX_RUNNER_REGISTRATION_TOKEN');
    expect(userData).not.toContain('WORKSPACE_ID');
  });

  it('renders a workspace mount script accepted by POSIX sh', () => {
    const script = extractWorkspaceMountScript(renderRunnerBootstrapUserData(options));

    expect(() => execFileSync('sh', ['-n', '-c', script])).not.toThrow();
  });

  it('powers off before publishing the environment when workspace setup fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shipfox-ec2-user-data-'));
    const commandDirectory = join(root, 'commands');
    const poweroffLog = join(root, 'poweroff.log');
    const script = extractWorkspaceMountScript(renderRunnerBootstrapUserData(options));

    await mkdir(commandDirectory, {recursive: true});
    await writeFile(join(commandDirectory, 'install'), '#!/bin/sh\nexit 1\n');
    await writeFile(
      join(commandDirectory, 'systemctl'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOOT_TEST_POWEROFF_LOG"\n',
    );
    await chmod(join(commandDirectory, 'install'), 0o755);
    await chmod(join(commandDirectory, 'systemctl'), 0o755);

    try {
      expect(() =>
        execFileSync('sh', ['-c', script], {
          env: {
            ...process.env,
            BOOT_TEST_POWEROFF_LOG: poweroffLog,
            PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
          },
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(await readFile(poweroffLog, 'utf8')).toBe('poweroff --no-wall\n');
    } finally {
      await rm(root, {force: true, recursive: true});
    }
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

function extractWorkspaceMountScript(userData: string): string {
  const marker = 'runcmd:\n  - |\n';
  const markerOffset = userData.indexOf(marker);

  expect(markerOffset).toBeGreaterThanOrEqual(0);
  return userData
    .slice(markerOffset + marker.length)
    .split('\n')
    .map((line) => (line.startsWith('      ') ? line.slice(6) : line))
    .join('\n');
}
