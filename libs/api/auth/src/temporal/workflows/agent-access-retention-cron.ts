import {log, proxyActivities} from '@temporalio/workflow';
import type {createAuthMaintenanceActivities} from '../activities/index.js';

const {agentAccessRetentionActivity} = proxyActivities<
  ReturnType<typeof createAuthMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  // Retry on the next cron tick so a timed-out attempt cannot overlap its own sweep.
  retry: {maximumAttempts: 1},
});

export async function agentAccessRetentionCron(): Promise<void> {
  const {deleted} = await agentAccessRetentionActivity();
  if (deleted > 0) log.info('Agent-access retention sweep complete', {deleted});
}
