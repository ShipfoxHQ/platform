import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {AgentSessionKekVersionStrandedError} from '#core/errors.js';

const meter = instanceMetrics.getMeter('agent');

export const modelProviderValidationCount = meter.createCounter<{
  model_provider: SupportedModelProviderId | 'custom';
  outcome: 'succeeded' | 'failed';
}>('model_provider_validation_attempted', {
  description: 'Model provider credential test attempts by model provider and outcome',
});

export const agentRuntimeConfigResolvedCount = meter.createCounter<{
  source: 'workspace' | 'instance';
  outcome: 'resolved' | 'unavailable' | 'decryption_failed';
}>('agent_runtime_config_resolved', {
  description: 'Lease-scoped agent runtime credential resolution by source and outcome',
});

export const sessionClaimReleaseCount = meter.createCounter<{
  path: 'step-attempt' | 'job-grace' | 'reap';
}>('agent_session_claim_released', {
  description: 'Agent session claims released by release path',
});

export const sessionClaimReapFailedCount = meter.createCounter('agent_session_claim_reap_failed', {
  description:
    'Stale agent session claim reaps that threw and were skipped; retried on the next cron run',
});

export type SessionCommitOutcome = 'committed' | 'retry_acked' | 'conflict';

/** Session transcript commit attempts by head-flip outcome. Outcome labels only; session keys never become label values. */
export const sessionCommitsCount = meter.createCounter<{outcome: SessionCommitOutcome}>(
  'agent_session_commits',
  {
    description: 'Agent session transcript commit attempts by outcome',
  },
);

const sessionBlobCapBytes = config.AGENT_SESSION_BLOB_CAP_BYTES;

/** Compressed bytes of committed session segments; bounded by the configured blob cap. */
export const sessionCommittedBytes = meter.createHistogram<Record<string, never>>(
  'agent_session_committed',
  {
    description: `Compressed bytes of committed agent session segments (bounded by the ${sessionBlobCapBytes}-byte configured blob cap)`,
    unit: 'By',
    advice: {
      explicitBucketBoundaries: [
        sessionBlobCapBytes / 64,
        sessionBlobCapBytes / 16,
        sessionBlobCapBytes / 4,
        sessionBlobCapBytes,
      ],
    },
  },
);

export type SessionKekRotationOutcome =
  | 'rotated'
  | 'skipped_current'
  | 'skipped_race'
  | 'none'
  | 'stranded'
  | 'failure';

const sessionKekRotationCount = meter.createCounter<{outcome: SessionKekRotationOutcome}>(
  'agent_session_kek_rotation',
  {description: 'Agent session data-key KEK rotation outcomes'},
);

const sessionKekRotationDuration = meter.createHistogram<{
  outcome: SessionKekRotationOutcome;
}>('agent_session_kek_rotation_duration', {
  description: 'Agent session data-key KEK rotation duration',
  unit: 'ms',
  advice: {explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]},
});

export function recordSessionKekRotation(params: {
  outcome: SessionKekRotationOutcome;
  count?: number | undefined;
  durationMs?: number | undefined;
}): void {
  const count = params.count ?? 1;
  if (count <= 0 && params.durationMs === undefined) return;

  try {
    if (count > 0) sessionKekRotationCount.add(count, {outcome: params.outcome});
    if (params.durationMs !== undefined) {
      sessionKekRotationDuration.record(params.durationMs, {outcome: params.outcome});
    }
  } catch {
    // Metrics must not affect session-key rotation outcomes.
  }
}

export function classifySessionKekRotationError(error: unknown): SessionKekRotationOutcome {
  if (error instanceof AgentSessionKekVersionStrandedError) return 'stranded';
  return 'failure';
}
