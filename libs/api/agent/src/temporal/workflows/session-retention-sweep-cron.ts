import {log, proxyActivities} from '@temporalio/workflow';
import type {createAgentSessionActivities} from '../activities/index.js';

const {sessionRetentionSweepActivity} = proxyActivities<
  ReturnType<typeof createAgentSessionActivities>
>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  // Retry on the next cron tick so a timed-out attempt cannot overlap its own still-running loop.
  retry: {maximumAttempts: 1},
});

export async function sessionRetentionSweepCron(): Promise<void> {
  const {sessionsDeleted, supersededPruned, orphansPruned, failed, iterations, timedOut} =
    await sessionRetentionSweepActivity();
  // Keep a workflow-level audit trail for this destructive sweep.
  log.info('Agent session retention sweep complete', {
    sessionsDeleted,
    supersededPruned,
    orphansPruned,
    failed,
    iterations,
    timedOut,
  });
}
