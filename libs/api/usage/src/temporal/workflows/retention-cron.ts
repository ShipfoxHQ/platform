import {log, proxyActivities} from '@temporalio/workflow';
import type {createUsageActivities} from '../activities/index.js';

const {usageRetentionActivity} = proxyActivities<ReturnType<typeof createUsageActivities>>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  retry: {maximumAttempts: 1},
});

export async function usageRetentionCron(): Promise<void> {
  const result = await usageRetentionActivity();
  log.info('Usage retention complete', {
    dropped: result.dropped,
    partitions: result.partitions,
  });
}
