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
  it('renders only the validated runner environment file', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).toBe(
      `${[
        'SHIPFOX_API_URL="https://api.shipfox.test"',
        'SHIPFOX_RUNNER_BOOTSTRAP_TOKEN="sf_rbt_sensitive-bootstrap-token"',
        'SHIPFOX_RUNNER_PROVIDER_KIND="ec2"',
        'SHIPFOX_RUNNER_PROTOCOL_VERSION="1"',
        'SHIPFOX_RUNNER_LABELS="linux,x64,self-hosted"',
        'SHIPFOX_RUNNER_WORKSPACE_ROOT="/var/lib/shipfox/workspaces"',
        'SHIPFOX_POLL_MAX_DURATION_MS="300000"',
        'SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"',
      ].join('\n')}\n`,
    );
    expect(userData).not.toContain('#cloud-config');
    expect(userData).not.toContain('write_files');
    expect(userData).not.toContain('runcmd');
  });

  it('does not render workspace-scoped registration material', () => {
    const userData = renderRunnerBootstrapUserData(options);

    expect(userData).not.toContain('SHIPFOX_RUNNER_REGISTRATION_TOKEN');
    expect(userData).not.toContain('WORKSPACE_ID');
  });

  it('keeps the rendered environment shell-compatible', () => {
    expect(() =>
      execFileSync('sh', ['-c', 'set -a; . /dev/stdin'], {
        input: renderRunnerBootstrapUserData(options),
      }),
    ).not.toThrow();
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
