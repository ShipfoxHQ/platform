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
      SHIPFOX_POLL_MAX_DURATION_MS="300000"
      SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS="3600"
runcmd:
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
      pollMaxDurationMs: 300_000,
      maxLifetimeSeconds: 3600,
    });
    expect(JSON.stringify(redacted)).not.toContain(options.bootstrapToken);
    expect(JSON.stringify(redacted)).not.toContain(options.apiUrl);
  });
});
