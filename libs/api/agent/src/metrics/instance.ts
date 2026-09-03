import type {Harness, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {
  AgentSessionKekVersionStrandedError,
  type AgentSessionUnavailableReason,
} from '#core/errors.js';

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

export const sessionCreatedCount = meter.createCounter<{
  source: 'claim' | 'carry_over';
}>('agent_session_created', {description: 'Agent session registry rows created by source'});

export const sessionResumedCount = meter.createCounter<{outcome: 'claimed'}>(
  'agent_session_resumed',
  {description: 'Agent session resume dispatches accepted'},
);

export const sessionForkedCount = meter.createCounter<{
  outcome: 'loaded' | 'fresh';
  harness: Harness;
  harness_inherited: boolean;
}>('agent_session_forked', {
  description:
    'Agent session fork dispatches by head-load outcome, pinned harness, and harness inheritance',
});

export type SessionClaimConflictOutcome = 'held' | 'lock_unavailable' | 'scope_mismatch';

export const sessionClaimConflictCount = meter.createCounter<{
  outcome: SessionClaimConflictOutcome;
}>('agent_session_claim_conflict', {
  description: 'Agent session claim conflicts by bounded outcome',
});

export const sessionLoadFailureCount = meter.createCounter<{
  outcome: AgentSessionUnavailableReason | 'unavailable';
}>('agent_session_load_failed', {
  description: 'Agent session transcript load failures by bounded reason',
});

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

export type SessionArtifactStorageOperation = 'put' | 'get' | 'list' | 'delete';

/** Failed session transcript object-store operations by bounded operation name. */
export const sessionArtifactStorageFailureCount = meter.createCounter<{
  operation: SessionArtifactStorageOperation;
}>('agent_session_artifact_storage_failed', {
  description: 'Agent session transcript object-store failures by operation',
});

export type SessionRetentionAction =
  | 'sessions_deleted'
  | 'superseded_pruned'
  | 'orphans_pruned'
  | 'failed';

const sessionRetentionSweepCount = meter.createCounter<{outcome: 'completed' | 'timed_out'}>(
  'agent_session_retention_sweeps',
  {description: 'Agent session retention sweep runs by completion outcome'},
);
const sessionRetentionActionCount = meter.createCounter<{action: SessionRetentionAction}>(
  'agent_session_retention_actions',
  {description: 'Agent session retention actions and isolated failures'},
);

export function recordSessionRetentionSweep(result: {
  sessionsDeleted: number;
  supersededPruned: number;
  orphansPruned: number;
  failed: number;
  timedOut: boolean;
}): void {
  try {
    sessionRetentionSweepCount.add(1, {outcome: result.timedOut ? 'timed_out' : 'completed'});
    const actions: ReadonlyArray<readonly [SessionRetentionAction, number]> = [
      ['sessions_deleted', result.sessionsDeleted],
      ['superseded_pruned', result.supersededPruned],
      ['orphans_pruned', result.orphansPruned],
      ['failed', result.failed],
    ];
    for (const [action, count] of actions) {
      if (count > 0) sessionRetentionActionCount.add(count, {action});
    }
  } catch {
    // Metrics must not change retention outcomes.
  }
}

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
