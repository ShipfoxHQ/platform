import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ModuleWorker} from '@shipfox/node-module';
import {Context} from '@temporalio/activity';
import {
  createGithubCheckoutTokenCacheMaintenanceActivities,
  type GithubCheckoutTokenCacheCleanup,
  type GithubCheckoutTokenCleanupConnection,
} from './activities/cleanup-github-checkout-token-cache.js';
import {INTEGRATIONS_GITHUB_MAINTENANCE_TASK_QUEUE} from './constants.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export interface CreateGithubCheckoutTokenCacheMaintenanceWorkerOptions {
  cache: GithubCheckoutTokenCacheCleanup;
  listConnections(): Promise<readonly GithubCheckoutTokenCleanupConnection[]>;
}

export function createGithubCheckoutTokenCacheMaintenanceWorker(
  options: CreateGithubCheckoutTokenCacheMaintenanceWorkerOptions,
): ModuleWorker {
  return {
    taskQueue: INTEGRATIONS_GITHUB_MAINTENANCE_TASK_QUEUE,
    workflowsPath,
    activities: () =>
      createGithubCheckoutTokenCacheMaintenanceActivities({
        ...options,
        heartbeat: () => Context.current().heartbeat(),
      }),
    workflows: [
      {
        name: 'cleanupGithubCheckoutTokenCacheCron',
        id: 'github-cleanup-checkout-token-cache',
        cronSchedule: '*/15 * * * *',
      },
    ],
  };
}
