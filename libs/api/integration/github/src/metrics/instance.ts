import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {MintErrorClass} from '#api/installation-token-envelope.js';
import {config} from '#config.js';

const meter = instanceMetrics.getMeter('github');

export type GithubInstallationTokenLookupOutcome =
  | 'ram-hit'
  | 'db-hit'
  | 'minted'
  | 'served-stale'
  | 'backoff'
  | 'contended-poll';

const installationTokenLookupCount = meter.createCounter<{
  outcome: GithubInstallationTokenLookupOutcome;
}>('github_installation_token_lookup', {
  description: 'GitHub installation token cache lookups by serving outcome',
});

const installationTokenMintCount = meter.createCounter<{outcome: 'success' | 'failure'}>(
  'github_installation_token_mint',
  {description: 'GitHub installation token mint attempts by outcome'},
);

const installationTokenMintDuration = meter.createHistogram<Record<string, never>>(
  'github_installation_token_mint_duration',
  {
    description: 'GitHub installation token mint duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]},
  },
);

const installationTokenFormatCount = meter.createCounter<{
  format: 'stateless' | 'stateful' | 'unknown';
  override: 'enabled' | 'disabled' | 'absent';
}>('github_installation_token_format', {
  description: 'GitHub installation tokens observed by format and requested override',
});

const installationTokenLockWaitDuration = meter.createHistogram<Record<string, never>>(
  'github_installation_token_lock_wait_duration',
  {
    description: 'GitHub installation token advisory lock acquire and hold duration',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]},
  },
);

const installationTokenBackoffCount = meter.createCounter<{
  reason: IntegrationProviderErrorReason;
  class: MintErrorClass;
}>('github_installation_token_backoff', {
  description: 'GitHub installation token mint backoff activations by reason and class',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect GitHub provider outcomes.
  }
}

export function recordInstallationTokenLookup(outcome: GithubInstallationTokenLookupOutcome): void {
  recordMetric(() => installationTokenLookupCount.add(1, {outcome}));
}

export function recordInstallationTokenMint(params: {
  outcome: 'success' | 'failure';
  durationMs: number;
}): void {
  recordMetric(() => {
    installationTokenMintCount.add(1, {outcome: params.outcome});
    installationTokenMintDuration.record(params.durationMs);
  });
}

export function recordInstallationTokenFormat(token: string): void {
  recordMetric(() => {
    installationTokenFormatCount.add(1, {
      format: installationTokenFormat(token),
      override: config.GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE ?? 'absent',
    });
  });
}

export function recordInstallationTokenLockWait(durationMs: number): void {
  recordMetric(() => installationTokenLockWaitDuration.record(durationMs));
}

export function recordInstallationTokenBackoff(params: {
  reason: IntegrationProviderErrorReason;
  class: MintErrorClass;
}): void {
  recordMetric(() => installationTokenBackoffCount.add(1, params));
}

function installationTokenFormat(token: string): 'stateless' | 'stateful' | 'unknown' {
  if (!token.startsWith('ghs_')) return 'unknown';
  const dotCount = token.slice(4).split('.').length - 1;
  if (dotCount === 2) return 'stateless';
  if (dotCount === 0) return 'stateful';
  return 'unknown';
}
