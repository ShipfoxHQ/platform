import {config} from '#config.js';
import {deleteExpiredEphemeralRegistrationTokens as deleteExpiredEphemeralRegistrationTokensDb} from '#db/ephemeral-registration-tokens.js';
import {expireStuckJobExecutions} from '#db/job-executions.js';
import {deleteExpiredReservations} from '#db/reservations.js';
import {reapStaleRunnerInstances as reapStaleRunnerInstancesDb} from '#db/runner-instances.js';
import {deleteExpiredRunnerSessions as deleteExpiredRunnerSessionsDb} from '#db/runner-sessions.js';
import {providerRunnerReapedCount, recordRunnerReservationReleased} from '#metrics/instance.js';
import {STUCK_JOB_THRESHOLD_SECONDS} from './maintenance-policy.js';

export interface DetectAndExpireStuckJobsParams {
  noFirstHeartbeatGraceSeconds?: number;
  thresholdSeconds?: number;
}

export async function detectAndExpireStuckJobs(
  params: DetectAndExpireStuckJobsParams = {},
): Promise<{expired: number}> {
  const reaped = await expireStuckJobExecutions({
    noFirstHeartbeatGraceSeconds:
      params.noFirstHeartbeatGraceSeconds ?? config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS,
    thresholdSeconds: params.thresholdSeconds ?? STUCK_JOB_THRESHOLD_SECONDS,
  });
  return {expired: reaped.length};
}

export async function deleteExpiredRunnerReservations(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredReservations(params);
  return {deleted};
}

export async function reapStaleRunnerInstances(params?: {
  thresholdSeconds?: number;
  limit?: number;
}): Promise<{reaped: number; reservationsReleased: number}> {
  const result = await reapStaleRunnerInstancesDb({
    thresholdSeconds:
      params?.thresholdSeconds ?? config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS,
    limit: params?.limit ?? config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT,
  });

  if (result.reaped > 0) providerRunnerReapedCount.add(result.reaped);
  recordRunnerReservationReleased({count: result.reservationsReleased, surface: 'reconcile'});

  return result;
}

export async function deleteExpiredRunnerSessions(params?: {
  manualRetentionDays?: number;
  ephemeralRetentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredRunnerSessionsDb({
    manualRetentionDays: params?.manualRetentionDays ?? config.RUNNER_SESSION_MANUAL_RETENTION_DAYS,
    ephemeralRetentionDays:
      params?.ephemeralRetentionDays ?? config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS,
    limit: params?.limit ?? config.RUNNER_SESSION_GC_BATCH_SIZE,
  });
  return {deleted};
}

export async function deleteExpiredEphemeralRegistrationTokens(params?: {
  retentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredEphemeralRegistrationTokensDb({
    retentionDays: params?.retentionDays ?? config.RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS,
    limit: params?.limit ?? config.RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE,
  });
  return {deleted};
}
