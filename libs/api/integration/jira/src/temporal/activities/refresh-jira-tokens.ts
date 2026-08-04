import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {JiraTokenStore} from '#core/tokens.js';
import {
  type JiraInstallation,
  listJiraInstallationsDueForTokenRefresh,
  markJiraInstallationTokenRefreshAttempt,
} from '#db/installations.js';
import {
  JIRA_REFRESH_TOKEN_PROACTIVE_REFRESH_AFTER_MS,
  JIRA_REFRESH_TOKEN_SWEEP_BATCH_SIZE,
} from '#temporal/constants.js';

const JIRA_REFRESH_TOKEN_HEARTBEAT_INTERVAL_MS = 15_000;

export interface JiraTokenRefreshActivityResult {
  refreshed: number;
  skipped: number;
  failed: number;
}

export interface CreateJiraMaintenanceActivitiesOptions {
  tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
  resolveConnection(
    connectionId: string,
  ): Promise<Pick<IntegrationConnection, 'lifecycleStatus'> | undefined>;
  listInstallations?: typeof listJiraInstallationsDueForTokenRefresh | undefined;
  markAttempted?: typeof markJiraInstallationTokenRefreshAttempt | undefined;
  now?: (() => Date) | undefined;
  heartbeat?: (() => void) | undefined;
}

export function createJiraMaintenanceActivities(options: CreateJiraMaintenanceActivitiesOptions) {
  const listInstallations = options.listInstallations ?? listJiraInstallationsDueForTokenRefresh;
  const markAttempted = options.markAttempted ?? markJiraInstallationTokenRefreshAttempt;
  const now = options.now ?? (() => new Date());
  const heartbeat = options.heartbeat ?? (() => undefined);

  return {
    async refreshJiraTokensActivity(): Promise<JiraTokenRefreshActivityResult> {
      const before = new Date(now().getTime() - JIRA_REFRESH_TOKEN_PROACTIVE_REFRESH_AFTER_MS);
      const installations = await listInstallations({
        before,
        limit: JIRA_REFRESH_TOKEN_SWEEP_BATCH_SIZE,
      });
      let refreshed = 0;
      let skipped = 0;
      let failed = 0;

      for (const installation of installations) {
        const heartbeatInterval = setInterval(heartbeat, JIRA_REFRESH_TOKEN_HEARTBEAT_INTERVAL_MS);
        try {
          heartbeat();
          await markAttempted(installation.connectionId);
          const connection = await options.resolveConnection(installation.connectionId);
          if (connection?.lifecycleStatus !== 'active') {
            skipped += 1;
            continue;
          }

          await options.tokenStore.getAccessToken({
            connectionId: installation.connectionId,
            forceRefresh: true,
          });
          refreshed += 1;
        } catch (error) {
          failed += 1;
          logRefreshFailure(installation, error);
        } finally {
          clearInterval(heartbeatInterval);
          heartbeat();
        }
      }

      return {refreshed, skipped, failed};
    },
  };
}

function logRefreshFailure(installation: JiraInstallation, error: unknown): void {
  logger().warn(
    {
      connectionId: installation.connectionId,
      err: error,
    },
    'Jira proactive token refresh failed',
  );
}
