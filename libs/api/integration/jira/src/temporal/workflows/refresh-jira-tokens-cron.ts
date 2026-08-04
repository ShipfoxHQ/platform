import {log, proxyActivities} from '@temporalio/workflow';
import type {createJiraMaintenanceActivities} from '../activities/index.js';

const {refreshJiraTokensActivity} = proxyActivities<
  ReturnType<typeof createJiraMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  // A later cron run is the retry mechanism. Retrying this serial sweep in-place
  // could overlap a still-running attempt after a timeout.
  retry: {maximumAttempts: 1},
});

export async function refreshJiraTokensCron(): Promise<void> {
  const result = await refreshJiraTokensActivity();
  if (result.refreshed > 0 || result.failed > 0 || result.skipped > 0) {
    log.info('Completed Jira proactive token refresh', {...result});
  }
}
