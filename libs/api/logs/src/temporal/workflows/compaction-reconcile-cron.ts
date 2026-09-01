import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {compactionReconcileActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
});

/** Cron-scheduled backstop that re-drives stale compaction and reaps temporary sibling objects. */
export async function compactionReconcileCron(): Promise<void> {
  const {restarted, reconciled, failed} = await compactionReconcileActivity();
  if (restarted > 0 || reconciled > 0 || failed > 0) {
    log.info('Reconciled stale compacted log streams', {restarted, reconciled, failed});
  }
}
