import {log, patched, proxyActivities} from '@temporalio/workflow';
import {STUCK_JOB_THRESHOLD_SECONDS} from '#core/maintenance-policy.js';

import type {createRunnersMaintenanceActivities} from '../activities/index.js';

const {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleRunnerInstancesActivity,
  recoverStaleIdleRunnerSessionsActivity,
} = proxyActivities<ReturnType<typeof createRunnersMaintenanceActivities>>({
  startToCloseTimeout: '60s',
});

export async function stuckJobDetector(): Promise<void> {
  try {
    const {deleted} = await deleteExpiredReservationsActivity();
    if (deleted > 0) {
      log.info('Stuck-job detector deleted expired runner reservations', {deleted});
    }
  } catch (error) {
    log.warn('Stuck-job detector failed to delete expired runner reservations', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const {deleted} = await deleteExpiredRunnerSessionsActivity();
    if (deleted > 0) {
      log.info('Stuck-job detector deleted expired runner sessions', {deleted});
    }
  } catch (error) {
    log.warn('Stuck-job detector failed to delete expired runner sessions', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const {deleted} = await deleteExpiredEphemeralRegistrationTokensActivity();
    if (deleted > 0) {
      log.info('Stuck-job detector deleted expired ephemeral registration tokens', {deleted});
    }
  } catch (error) {
    log.warn('Stuck-job detector failed to delete expired ephemeral registration tokens', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const {expired} = await detectAndExpireStuckJobsActivity({
    thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
  });
  if (expired > 0) {
    log.info('Stuck-job detector expired job leases', {
      expired,
      thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
    });
  }

  await recoverStaleIdleRunnerSessionsIfPatched();

  const {reaped, reservationsReleased} = await reapStaleRunnerInstancesActivity();
  if (reaped > 0) {
    log.info('Stuck-job detector reaped stale provisioned runners', {
      reaped,
      reservationsReleased,
    });
  }
}

async function recoverStaleIdleRunnerSessionsIfPatched(): Promise<void> {
  if (!patched('recover-stale-idle-sessions')) return;

  const {recovered} = await recoverStaleIdleRunnerSessionsActivity();
  if (recovered > 0) {
    log.info('Stuck-job detector recovered stale idle runner sessions', {recovered});
  }
}
