import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import type {RunnerTerminationReason} from '#core/entities/runner-instance.js';
import type {Tx} from '#db/db.js';
import {
  persistRunnerTerminationAuthorization,
  persistRunnerTerminationAuthorizationTx,
  type RunnerEnrollmentRevocationCounts,
  type TerminationAuthorizationResult,
  type TerminationAuthorizationTelemetry,
  type TerminationAuthorizationTxResult,
  type TerminationReasonResolution,
} from '#db/runner-instances.js';
import {
  recordRunnerTerminationAuthorizationIssued,
  recordRunnerTerminationAuthorizationRejected,
} from '#metrics/index.js';

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
  const result = await persistRunnerTerminationAuthorization({
    ...params,
    resolveTerminationReason: () => resolveRunnerTerminationReason(params),
  });
  recordRunnerTerminationAuthorizationTelemetry(params, result.telemetry);
  return withoutTelemetry(result);
}

export async function authorizeRunnerTerminationTx(
  tx: Tx,
  params: RunnerTerminationAuthorizationParams,
  onRevocation?: (counts: RunnerEnrollmentRevocationCounts) => void,
): Promise<TerminationAuthorizationTxResult> {
  return await persistRunnerTerminationAuthorizationTx(
    tx,
    {
      ...params,
      resolveTerminationReason: () => resolveRunnerTerminationReason(params),
    },
    onRevocation,
  );
}

export function recordRunnerTerminationAuthorizationTelemetry(
  params: RunnerTerminationAuthorizationParams,
  telemetry: TerminationAuthorizationTelemetry | null,
): void {
  if (!telemetry) return;

  const fields = {
    component: 'api-runners',
    provisionerId: params.provisionerId,
    providerRunnerId: params.providerRunnerId,
    reason: telemetry.reason,
  };
  if (telemetry.outcome === 'issued') {
    recordRunnerTerminationAuthorizationIssued(telemetry.reason);
    safelyLog(
      'info',
      {...fields, event: 'runner.termination_authorization_issued'},
      'Runner termination authorization issued',
    );
  } else {
    recordRunnerTerminationAuthorizationRejected(telemetry.reason);
    safelyLog(
      'warn',
      {...fields, event: 'runner.termination_authorization_rejected'},
      'termination authorization rejected',
    );
  }
}

function safelyLog(
  level: 'info' | 'warn',
  fields: {
    event: string;
    provisionerId: string;
    providerRunnerId: string;
    reason: string;
  },
  message: string,
): void {
  try {
    logger()[level](fields, message);
  } catch {
    // Telemetry failures must not change authorization behavior.
  }
}

function withoutTelemetry(
  result: TerminationAuthorizationTxResult,
): TerminationAuthorizationResult {
  if (result.desiredIntent === 'keep')
    return {
      desiredIntent: 'keep',
      terminationAuthorizedAt: null,
      terminationReason: null,
    };
  return {
    desiredIntent: 'terminate',
    terminationAuthorizedAt: result.terminationAuthorizedAt,
    terminationReason: result.terminationReason,
  };
}

export function resolveRunnerTerminationReason(
  params: RunnerTerminationAuthorizationParams,
): TerminationReasonResolution {
  if (!terminationReasons.has(params.reason))
    return {reason: null, rejectionReason: 'unknown-reason'};

  const reason = params.reason as RunnerTerminationReason;
  if (!config[terminationReasonGate[reason]]) return {reason: null, rejectionReason: reason};

  return {reason};
}
