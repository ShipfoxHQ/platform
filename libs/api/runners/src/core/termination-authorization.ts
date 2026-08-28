import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import type {RunnerTerminationReason} from '#core/entities/runner-instance.js';
import type {Tx} from '#db/db.js';
import {
  persistRunnerTerminationAuthorization,
  persistRunnerTerminationAuthorizationTx,
  type RunnerEnrollmentRevocationCounts,
  type TerminationAuthorizationResult,
} from '#db/runner-instances.js';

export interface RunnerTerminationAuthorizationParams {
  provisionerId: string;
  providerRunnerId: string;
  reason: string;
}

const terminationReasonGate: Record<RunnerTerminationReason, keyof typeof config> = {
  'registration-deadline': 'RUNNER_TERMINATION_REASON_REGISTRATION_DEADLINE_ENABLED',
  'activation-timeout': 'RUNNER_TERMINATION_REASON_ACTIVATION_TIMEOUT_ENABLED',
  'runner-unresponsive': 'RUNNER_TERMINATION_REASON_RUNNER_UNRESPONSIVE_ENABLED',
  'lease-expired': 'RUNNER_TERMINATION_REASON_LEASE_EXPIRED_ENABLED',
  'session-exhausted': 'RUNNER_TERMINATION_REASON_SESSION_EXHAUSTED_ENABLED',
  'stopping-timeout': 'RUNNER_TERMINATION_REASON_STOPPING_TIMEOUT_ENABLED',
  'provider-health-failed': 'RUNNER_TERMINATION_REASON_PROVIDER_HEALTH_FAILED_ENABLED',
  'job-cancelled': 'RUNNER_TERMINATION_REASON_JOB_CANCELLED_ENABLED',
  'job-timeout': 'RUNNER_TERMINATION_REASON_JOB_TIMEOUT_ENABLED',
  'terminal-state': 'RUNNER_TERMINATION_REASON_TERMINAL_STATE_ENABLED',
};

const terminationReasons = new Set<string>(Object.keys(terminationReasonGate));

export async function authorizeRunnerTermination(
  params: RunnerTerminationAuthorizationParams,
): Promise<TerminationAuthorizationResult> {
  return await persistRunnerTerminationAuthorization({
    ...params,
    resolveTerminationReason: () => resolveTerminationReason(params),
  });
}

export async function authorizeRunnerTerminationTx(
  tx: Tx,
  params: RunnerTerminationAuthorizationParams,
  onRevocation?: (counts: RunnerEnrollmentRevocationCounts) => void,
): Promise<TerminationAuthorizationResult> {
  return await persistRunnerTerminationAuthorizationTx(
    tx,
    {
      ...params,
      resolveTerminationReason: () => resolveTerminationReason(params),
    },
    onRevocation,
  );
}

function resolveTerminationReason(
  params: RunnerTerminationAuthorizationParams,
): RunnerTerminationReason | null {
  if (!terminationReasons.has(params.reason)) {
    logger().warn(
      {
        provisionerId: params.provisionerId,
        providerRunnerId: params.providerRunnerId,
        reason: params.reason,
      },
      'termination authorization rejected for unknown reason',
    );
    return null;
  }

  const reason = params.reason as RunnerTerminationReason;
  if (!config[terminationReasonGate[reason]]) {
    logger().warn(
      {provisionerId: params.provisionerId, providerRunnerId: params.providerRunnerId, reason},
      'termination authorization rejected by disabled reason gate',
    );
    return null;
  }

  return reason;
}
