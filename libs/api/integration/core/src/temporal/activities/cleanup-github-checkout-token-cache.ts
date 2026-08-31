import {logger} from '@shipfox/node-opentelemetry';

const GITHUB_INSTALLATION_ID_PATTERN = /^[1-9]\d*$/u;
const DEFAULT_BATCH_SIZE = 100;

export interface GithubCheckoutTokenCleanupConnection {
  workspaceId: string;
  externalAccountId: string;
}

export interface GithubCheckoutTokenCacheCleanup {
  cleanupExpiredInstallation(
    workspaceId: string,
    installationId: number,
    limit?: number,
  ): Promise<number>;
}

export interface CreateGithubCheckoutTokenCacheMaintenanceActivitiesOptions {
  cache: GithubCheckoutTokenCacheCleanup;
  listConnections(): Promise<readonly GithubCheckoutTokenCleanupConnection[]>;
  batchSize?: number | undefined;
  heartbeat?: (() => void) | undefined;
}

export interface GithubCheckoutTokenCacheCleanupActivityResult {
  deleted: number;
  failed: number;
  scanned: number;
  skipped: number;
}

export function createGithubCheckoutTokenCacheMaintenanceActivities(
  options: CreateGithubCheckoutTokenCacheMaintenanceActivitiesOptions,
) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error(`Invalid GitHub checkout-token cleanup batch size: ${batchSize}`);
  }

  return {
    async cleanupGithubCheckoutTokenCacheActivity(): Promise<GithubCheckoutTokenCacheCleanupActivityResult> {
      const connections = await options.listConnections();
      let remaining = batchSize;
      let deleted = 0;
      let failed = 0;
      let scanned = 0;
      let skipped = 0;

      for (const connection of connections) {
        if (remaining === 0 || scanned + skipped >= batchSize) break;
        if (!GITHUB_INSTALLATION_ID_PATTERN.test(connection.externalAccountId)) {
          skipped += 1;
          continue;
        }
        const installationId = Number(connection.externalAccountId);
        if (!Number.isSafeInteger(installationId)) {
          skipped += 1;
          continue;
        }

        options.heartbeat?.();
        scanned += 1;
        try {
          const removed = await options.cache.cleanupExpiredInstallation(
            connection.workspaceId,
            installationId,
            remaining,
          );
          deleted += removed;
          remaining -= removed;
        } catch (error) {
          failed += 1;
          logger().warn(
            {installationId, err: error},
            'GitHub checkout-token cache cleanup failed for installation',
          );
        }
      }

      options.heartbeat?.();
      return {deleted, failed, scanned, skipped};
    },
  };
}
