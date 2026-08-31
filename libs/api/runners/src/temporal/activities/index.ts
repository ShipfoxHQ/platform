import {
  deleteExpiredEphemeralRegistrationTokensActivity,
  deleteExpiredReservationsActivity,
  deleteExpiredRunnerSessionsActivity,
  detectAndExpireStuckJobsActivity,
  reapStaleRunnerInstancesActivity,
  recoverStaleIdleRunnerSessionsActivity,
} from './maintenance-activities.js';

export function createRunnersMaintenanceActivities() {
  return {
    deleteExpiredEphemeralRegistrationTokensActivity,
    deleteExpiredReservationsActivity,
    deleteExpiredRunnerSessionsActivity,
    detectAndExpireStuckJobsActivity,
    reapStaleRunnerInstancesActivity,
    recoverStaleIdleRunnerSessionsActivity,
  };
}
