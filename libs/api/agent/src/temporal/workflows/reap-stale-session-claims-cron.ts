import {log, proxyActivities} from '@temporalio/workflow';
import type {createAgentSessionActivities} from '../activities/index.js';

const {reapStaleSessionClaimsActivity} = proxyActivities<
  ReturnType<typeof createAgentSessionActivities>
>({
  startToCloseTimeout: '5 minutes',
});

export async function reapStaleSessionClaimsCron(): Promise<void> {
  const {reaped, failed} = await reapStaleSessionClaimsActivity();
  if (reaped > 0 || failed > 0) {
    log.info('Reaped stale agent session claims', {reaped, failed});
  }
}
