import {log, proxyActivities} from '@temporalio/workflow';
import type {createGithubCheckoutTokenCacheMaintenanceActivities} from '../activities/cleanup-github-checkout-token-cache.js';

const {cleanupGithubCheckoutTokenCacheActivity} = proxyActivities<
  ReturnType<typeof createGithubCheckoutTokenCacheMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  retry: {maximumAttempts: 1},
});

export async function cleanupGithubCheckoutTokenCacheCron(): Promise<void> {
  const result = await cleanupGithubCheckoutTokenCacheActivity();
  if (result.deleted > 0 || result.failed > 0) {
    log.info('Completed GitHub checkout-token cache cleanup', {...result});
  }
}
