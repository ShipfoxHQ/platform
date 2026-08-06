import {log, proxyActivities} from '@temporalio/workflow';
import type {createIntegrationsMaintenanceActivities} from '../activities/index.js';
import {CLEANUP_SECRETS_ACTIVITY_TIMEOUT_MS} from '../constants.js';

const {cleanupIntegrationSecretsActivity} = proxyActivities<
  ReturnType<typeof createIntegrationsMaintenanceActivities>
>({
  startToCloseTimeout: CLEANUP_SECRETS_ACTIVITY_TIMEOUT_MS,
  heartbeatTimeout: '1 minute',
  // The activity records a per-row retry schedule. A later cron run retries the
  // row without replaying the whole sweep in Temporal.
  retry: {maximumAttempts: 1},
});

export async function cleanupIntegrationSecretsCron(): Promise<void> {
  const result = await cleanupIntegrationSecretsActivity();
  if (result.claimed > 0) {
    log.info('Completed integration connection secret cleanup sweep', {...result});
  }
}
