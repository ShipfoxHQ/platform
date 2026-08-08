const CLOUD_INIT_HEADER = '#cloud-config';
const RUNNER_ENV_PATH = '/etc/shipfox/runner.env';
const RUNNER_ENV_TEMP_PATH = '/etc/shipfox/runner.env.tmp';

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
  readonly pollMaxDurationMs: number;
  readonly maxLifetimeSeconds: number;
}

interface RunnerBootstrapEnvironment {
  readonly SHIPFOX_API_URL: string;
  readonly SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: string;
  readonly SHIPFOX_RUNNER_PROVIDER_KIND: string;
  readonly SHIPFOX_RUNNER_PROTOCOL_VERSION: string;
  readonly SHIPFOX_RUNNER_LABELS: string;
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
    .map((line) => `${padding}${line}`)
    .join('\n');
}
