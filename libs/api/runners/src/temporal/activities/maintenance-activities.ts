import {
  deleteExpiredEphemeralRegistrationTokens,
  deleteExpiredRunnerReservations,
  deleteExpiredRunnerSessions,
  detectAndExpireStuckJobs,
  reapStaleRunnerInstances,
  recoverStaleIdleRunnerSessions,
} from '#core/maintenance.js';

export function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return detectAndExpireStuckJobs(params);
}

export function deleteExpiredReservationsActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredRunnerReservations(params);
}

export function reapStaleRunnerInstancesActivity(params?: {
  thresholdSeconds: number;
  limit: number;
}): Promise<{reaped: number; reservationsReleased: number}> {
  return reapStaleRunnerInstances(params);
}

export function recoverStaleIdleRunnerSessionsActivity(params?: {
  limit?: number;
}): Promise<{recovered: number}> {
  return recoverStaleIdleRunnerSessions(params);
}

export function deleteExpiredRunnerSessionsActivity(params?: {
  manualRetentionDays?: number;
  ephemeralRetentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredRunnerSessions(params);
}

export function deleteExpiredEphemeralRegistrationTokensActivity(params?: {
  retentionDays?: number;
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredEphemeralRegistrationTokens(params);
}
