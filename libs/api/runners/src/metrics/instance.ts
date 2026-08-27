import {instanceMetrics, logger} from '@shipfox/node-opentelemetry';
import type {RunnerAssignmentRejectionReason} from '#core/errors.js';

const meter = instanceMetrics.getMeter('runners');

export type RunnerLaunchKind = 'demand' | 'warm' | 'manual';
export type RunnerAssignmentSurface = 'provisioner' | 'enrollment';

type ProviderRunnerLifecycleLabels = {
  provider: string;
  launch_kind: RunnerLaunchKind;
};

type ProviderRunnerAssignmentLifecycleLabels = ProviderRunnerLifecycleLabels & {
  surface: RunnerAssignmentSurface;
};

type JobExecutionQueueTimeLabels = {
  provider: string;
  launch_kind: RunnerLaunchKind | 'unknown';
};

export interface JobExecutionQueueTimeObservation {
  durationMilliseconds: number;
  provider: string | null;
  launchKind: RunnerLaunchKind | 'unknown';
}

export interface ProviderRunnerLifecycleObservation {
  durationMilliseconds: number;
  provider: string | null;
  launchKind: RunnerLaunchKind;
  runnerInstanceId?: string;
}

export interface ProviderRunnerAssignmentObservation extends ProviderRunnerLifecycleObservation {
  surface: RunnerAssignmentSurface;
}

export const UNKNOWN_PROVIDER_KIND = 'unknown';

const lifecycleDurationBuckets = {
  long: [
    100, 500, 1_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000,
    300_000, 600_000,
  ],
  short: [10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000],
};

const queueTimeBucketsMilliseconds = [
  100, 500, 1_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000, 300_000,
  600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000,
];

// Keep the ordered lifecycle phases as separate histograms so long boot times do not flatten
// short handoffs. Assignment is the only phase with a surface dimension.
export const providerRunnerCreatedToControlSessionDuration =
  meter.createHistogram<ProviderRunnerLifecycleLabels>(
    'runners_provider_runner_created_to_control_session',
    {
      description: 'Provider runner row creation to control-session creation duration',
      unit: 'ms',
      advice: {explicitBucketBoundaries: lifecycleDurationBuckets.long},
    },
  );

export const providerRunnerControlSessionToAssignmentDuration =
  meter.createHistogram<ProviderRunnerAssignmentLifecycleLabels>(
    'runners_provider_runner_control_session_to_assignment',
    {
      description: 'Provider runner control-session creation to reservation assignment duration',
      unit: 'ms',
      advice: {explicitBucketBoundaries: lifecycleDurationBuckets.long},
    },
  );

export const providerRunnerAssignmentToActivationDuration =
  meter.createHistogram<ProviderRunnerLifecycleLabels>(
    'runners_provider_runner_assignment_to_activation',
    {
      description:
        'Provider runner reservation assignment to workspace runner-session creation duration',
      unit: 'ms',
      advice: {explicitBucketBoundaries: lifecycleDurationBuckets.short},
    },
  );

export const providerRunnerActivationToFirstClaimDuration =
  meter.createHistogram<ProviderRunnerLifecycleLabels>(
    'runners_provider_runner_activation_to_first_claim',
    {
      description: 'Provider runner workspace runner-session creation to first job claim duration',
      unit: 'ms',
      advice: {explicitBucketBoundaries: lifecycleDurationBuckets.short},
    },
  );

export const jobExecutionQueueTimeDuration = meter.createHistogram<JobExecutionQueueTimeLabels>(
  'runners_job_execution_queue_time',
  {
    description: 'Job execution pending queue duration from enqueue to runner claim',
    unit: 'ms',
    advice: {explicitBucketBoundaries: queueTimeBucketsMilliseconds},
  },
);

export const providerRunnerAssignmentRejectedCount = meter.createCounter<{
  reason: RunnerAssignmentRejectionReason;
  surface: RunnerAssignmentSurface;
}>('runners_provider_runner_assignment_rejected', {
  description: 'Provider runner assignment operations rejected by bounded reason and surface',
});

export const jobExecutionEnqueuedCount = meter.createCounter<Record<string, never>>(
  'runners_job_execution_enqueued',
  {
    description: 'Job executions added to the pending queue',
  },
);

export const jobExecutionClaimedCount = meter.createCounter<{outcome: 'claimed' | 'empty'}>(
  'runners_job_execution_claimed',
  {description: 'Job execution claim attempts by outcome'},
);

export const jobExecutionLeaseExpiredCount = meter.createCounter<Record<string, never>>(
  'runners_job_execution_lease_expired',
  {description: 'Job execution leases reaped after passing the heartbeat threshold'},
);

export const staleJobCandidateRatio = meter.createHistogram<Record<string, never>>(
  'runners_job_stale_candidate_ratio',
  {
    description:
      'Proportion of running job leases that are stale, observed in one database snapshot',
    advice: {explicitBucketBoundaries: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]},
  },
);

export const jobLeaseExpiryDeferredCount = meter.createCounter<{cause: 'correlated-stale'}>(
  'runners_job_lease_expiry_deferred',
  {description: 'Bounded stale job lease expiry batches deferred by the circuit breaker'},
);

export const providerRunnerReportCount = meter.createCounter<{
  state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
}>('runners_provider_runner_reported', {
  description: 'Provisioned runner lifecycle reports accepted by state',
});

export const runnerBootstrapExchangeCount = meter.createCounter<{
  outcome: 'accepted' | 'rejected';
}>('runners_runner_bootstrap_exchange', {
  description: 'Runner bootstrap-token exchanges by outcome',
});

export type RunnerActivationTokenNotIssuedReason =
  | 'runner-not-found'
  | 'missing-workspace'
  | 'existing-session'
  | 'not-running';

export type RunnerActivationTokenNotIssuedSurface = 'enrollment' | 'poll';

export const runnerActivationTokenNotIssuedCount = meter.createCounter<{
  reason: RunnerActivationTokenNotIssuedReason;
  surface: RunnerActivationTokenNotIssuedSurface;
}>('runners_runner_activation_token_not_issued', {
  description: 'Runner activation token issuance skips by reason and surface',
});

export const runnerControlHeartbeatCount = meter.createCounter<Record<string, never>>(
  'runners_runner_control_heartbeat',
  {description: 'Pre-workspace runner-control heartbeats accepted'},
);

export const providerRunnerReapedCount = meter.createCounter<Record<string, never>>(
  'runners_provider_runner_reaped',
  {
    description: 'Stale provisioned runners marked failed by backend maintenance',
  },
);

export const providerRunnerCountDivergenceCount = meter.createCounter<{
  template_key?: string;
  state: 'starting' | 'running';
  direction: 'backend-higher' | 'advertised-higher';
}>('runners_provider_runner_count_divergence', {
  description:
    'Absolute difference between provisioner-advertised and backend-observed provisioned runner counts',
});

export const providerRunnerReconcileCallCount = meter.createCounter<Record<string, never>>(
  'runners_provider_runner_reconcile_called',
  {description: 'Provisioned runner reconcile calls completed successfully'},
);

export const providerRunnerAbsentTerminatedCount = meter.createCounter<Record<string, never>>(
  'runners_provider_runner_absent_terminated',
  {
    description:
      'Owned provisioned runners marked terminated because they were absent from reconcile',
  },
);

export const providerRunnerTerminateIntentIssuedCount = meter.createCounter<{
  surface: 'poll-demand' | 'reconcile';
  reason: 'activation-timeout' | 'job-cancelled' | 'terminal-state';
}>('runners_provider_runner_terminate_intent_issued', {
  description: 'Provisioned runner terminate intents returned to provisioners',
});

export const providerRunnerTerminateIntentHonoredCount = meter.createCounter<{
  reason: 'activation-timeout' | 'job-cancelled';
}>('runners_provider_runner_terminate_intent_honored', {
  description: 'Provisioned runner terminate intents honored by first transition to terminated',
});

export const providerRunnerActivationOutcomeCount = meter.createCounter<{
  outcome: 'reaped' | 'rebound';
}>('runners_provider_runner_activation_outcome', {
  description: 'Demand-backed runner activation outcomes by recovery action',
});

export type RunnerReservationReleaseSurface = 'first-claim' | 'terminal-report' | 'reconcile';

export const reservationReleasedCount = meter.createCounter<{
  surface: RunnerReservationReleaseSurface;
}>('runners_reservation_released', {
  description: 'Reservation units released by lifecycle surface',
});

export function recordRunnerReservationReleased(params: {
  count: number;
  surface: RunnerReservationReleaseSurface;
}): void {
  if (params.count <= 0) return;
  recordMetric(() => reservationReleasedCount.add(params.count, {surface: params.surface}));
}

export type RunnerReservationPromotionFailureReason =
  | 'reservation-expired'
  | 'reservation-not-found'
  | 'already-assigned'
  | 'not-assignable';

export const runnerReservationPromotionFailureCount = meter.createCounter<{
  reason: RunnerReservationPromotionFailureReason;
}>('runners_reservation_promotion_failures', {
  description: 'Runner reservation promotion failures during enrollment by reason',
});

export type RunnerReservationCapacityFailureReason =
  | 'reservation-not-found'
  | 'reservation-kind-mismatch'
  | 'reservation-expired'
  | 'capacity-exhausted';

export const runnerReservationCapacityFailureCount = meter.createCounter<{
  reason: RunnerReservationCapacityFailureReason;
}>('runners_reservation_capacity_failures', {
  description: 'Runner reservation admission shortfalls by reason',
});

export type RunnersRateLimitAction = 'provisioner-mint' | 'ephemeral-register';
export type RunnersRateLimitScope = 'provisioner' | 'ephemeral-token';
export type RunnersRateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

const rateLimitCheckCount = meter.createCounter<{
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  outcome: RunnersRateLimitOutcome;
}>('runners_rate_limit_checks', {
  description: 'Runners rate limit checks by action, scope, and outcome',
});

const rateLimitPruneFailureCount = meter.createCounter('runners_rate_limit_prune_failures', {
  description: 'Runners rate limit prune failures',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect runner or provisioner request outcomes.
  }
}

function resolveProviderRunnerMetricProvider(params: {
  provider: string | null;
  runnerInstanceId?: string;
}): string {
  if (params.provider) return params.provider;
  logger().debug(
    {runnerInstanceId: params.runnerInstanceId},
    'Provider runner metric missing provider kind',
  );
  return UNKNOWN_PROVIDER_KIND;
}

export function recordProviderRunnerCreatedToControlSession(
  params: ProviderRunnerLifecycleObservation,
): void {
  if (params.durationMilliseconds < 0) return;
  recordMetric(() =>
    providerRunnerCreatedToControlSessionDuration.record(params.durationMilliseconds, {
      provider: resolveProviderRunnerMetricProvider(params),
      launch_kind: params.launchKind,
    }),
  );
}

export function recordProviderRunnerControlSessionToAssignment(
  params: ProviderRunnerAssignmentObservation,
): void {
  if (params.durationMilliseconds < 0) return;
  recordMetric(() =>
    providerRunnerControlSessionToAssignmentDuration.record(params.durationMilliseconds, {
      provider: resolveProviderRunnerMetricProvider(params),
      launch_kind: params.launchKind,
      surface: params.surface,
    }),
  );
}

export function recordProviderRunnerAssignmentToActivation(
  params: ProviderRunnerLifecycleObservation,
): void {
  if (params.durationMilliseconds < 0) return;
  recordMetric(() =>
    providerRunnerAssignmentToActivationDuration.record(params.durationMilliseconds, {
      provider: resolveProviderRunnerMetricProvider(params),
      launch_kind: params.launchKind,
    }),
  );
}

export function recordProviderRunnerActivationToFirstClaim(
  params: ProviderRunnerLifecycleObservation,
): void {
  if (params.durationMilliseconds < 0) return;
  recordMetric(() =>
    providerRunnerActivationToFirstClaimDuration.record(params.durationMilliseconds, {
      provider: resolveProviderRunnerMetricProvider(params),
      launch_kind: params.launchKind,
    }),
  );
}

export function recordJobExecutionQueueTime(params: JobExecutionQueueTimeObservation): void {
  if (params.durationMilliseconds < 0) return;
  recordMetric(() =>
    jobExecutionQueueTimeDuration.record(params.durationMilliseconds, {
      provider: params.provider ?? UNKNOWN_PROVIDER_KIND,
      launch_kind: params.launchKind,
    }),
  );
}

export function recordProviderRunnerAssignmentRejected(params: {
  reason: RunnerAssignmentRejectionReason;
  surface: RunnerAssignmentSurface;
}): void {
  recordMetric(() => providerRunnerAssignmentRejectedCount.add(1, params));
}

export function recordRunnerReservationPromotionFailure(
  reason: RunnerReservationPromotionFailureReason,
): void {
  recordMetric(() => runnerReservationPromotionFailureCount.add(1, {reason}));
}

export function recordRunnerActivationTokenNotIssued(params: {
  reason: RunnerActivationTokenNotIssuedReason;
  surface: RunnerActivationTokenNotIssuedSurface;
}): void {
  recordMetric(() => runnerActivationTokenNotIssuedCount.add(1, params));
}

export function recordRunnerReservationCapacityFailure(
  reason: RunnerReservationCapacityFailureReason,
  count: number,
): void {
  if (count <= 0) return;
  recordMetric(() => runnerReservationCapacityFailureCount.add(count, {reason}));
}

export function recordRunnersRateLimitCheck(params: {
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  outcome: RunnersRateLimitOutcome;
}): void {
  recordMetric(() =>
    rateLimitCheckCount.add(1, {
      action: params.action,
      scope: params.scope,
      outcome: params.outcome,
    }),
  );
}

export function recordRunnersRateLimitPruneFailure(): void {
  recordMetric(() => rateLimitPruneFailureCount.add(1));
}

export function recordProviderRunnerActivationOutcome(params: {
  outcome: 'reaped' | 'rebound';
  count?: number;
}): void {
  recordMetric(() =>
    providerRunnerActivationOutcomeCount.add(params.count ?? 1, {outcome: params.outcome}),
  );
}
