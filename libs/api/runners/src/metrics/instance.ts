import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runners');

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

export const reservationReleasedCount = meter.createCounter<Record<string, never>>(
  'runners_reservation_released',
  {description: 'Reservation units released from terminal provisioned runner reports'},
);

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
