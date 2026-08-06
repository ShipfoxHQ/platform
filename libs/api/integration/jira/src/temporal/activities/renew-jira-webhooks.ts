import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {JiraApiClient} from '#api/client.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {registerJiraWebhook} from '#core/webhook-registration.js';
import {
  type JiraInstallation,
  listJiraInstallationsDueForWebhookRenewal,
  updateJiraInstallationWebhookIfUnchanged,
} from '#db/installations.js';
import {
  JIRA_WEBHOOK_RENEWAL_SWEEP_BATCH_SIZE,
  JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS,
} from '#temporal/constants.js';

const JIRA_WEBHOOK_HEARTBEAT_INTERVAL_MS = 15_000;

export interface JiraWebhookRenewalActivityResult {
  renewed: number;
  reregistered: number;
  skipped: number;
  failed: number;
}

export interface CreateJiraWebhookRenewalActivitiesOptions {
  tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
  jira?:
    | Pick<
        JiraApiClient,
        'refreshDynamicWebhooks' | 'registerDynamicWebhook' | 'deleteDynamicWebhook'
      >
    | undefined;
  webhookUrlForConnection?: ((connectionId: string) => string) | undefined;
  resolveConnection(
    connectionId: string,
  ): Promise<Pick<IntegrationConnection, 'lifecycleStatus'> | undefined>;
  listInstallations?: typeof listJiraInstallationsDueForWebhookRenewal | undefined;
  updateInstallation?: typeof updateJiraInstallationWebhookIfUnchanged | undefined;
  registerWebhook?: typeof registerJiraWebhook | undefined;
  now?: (() => Date) | undefined;
  heartbeat?: (() => void) | undefined;
}

export function createJiraWebhookRenewalActivities(
  options: CreateJiraWebhookRenewalActivitiesOptions,
) {
  const listInstallations = options.listInstallations ?? listJiraInstallationsDueForWebhookRenewal;
  const updateInstallation = options.updateInstallation ?? updateJiraInstallationWebhookIfUnchanged;
  const registerWebhook = options.registerWebhook ?? registerJiraWebhook;
  const now = options.now ?? (() => new Date());
  const heartbeat = options.heartbeat ?? (() => undefined);

  return {
    async renewJiraWebhooksActivity(): Promise<JiraWebhookRenewalActivityResult> {
      const renewalDeadline = new Date(now().getTime() + JIRA_WEBHOOK_RENEWAL_THRESHOLD_MS);
      const installations = await listInstallations({
        before: renewalDeadline,
        limit: JIRA_WEBHOOK_RENEWAL_SWEEP_BATCH_SIZE,
      });
      let renewed = 0;
      let reregistered = 0;
      let skipped = 0;
      let failed = 0;

      for (const installation of installations) {
        const heartbeatInterval = setInterval(heartbeat, JIRA_WEBHOOK_HEARTBEAT_INTERVAL_MS);
        try {
          heartbeat();
          if (!isDueForRenewal(installation, renewalDeadline)) {
            skipped += 1;
            continue;
          }

          const connection = await options.resolveConnection(installation.connectionId);
          if (connection?.lifecycleStatus !== 'active') {
            skipped += 1;
            continue;
          }

          if (!options.jira || !options.webhookUrlForConnection) {
            throw new Error('Jira webhook renewal dependencies are not configured');
          }

          const accessToken = await options.tokenStore.getAccessToken({
            connectionId: installation.connectionId,
          });
          const webhookExpiresAt =
            installation.webhookIds.length === 0
              ? undefined
              : await options.jira.refreshDynamicWebhooks({
                  accessToken,
                  cloudId: installation.cloudId,
                  webhookIds: installation.webhookIds,
                });

          if (webhookExpiresAt === undefined) {
            await registerWebhook({
              jira: options.jira,
              connectionId: installation.connectionId,
              cloudId: installation.cloudId,
              accessToken,
              webhookUrl: options.webhookUrlForConnection(installation.connectionId),
              now,
              replaceExistingWebhooks: true,
            });
            reregistered += 1;
          } else {
            const updated = await updateInstallation({
              connectionId: installation.connectionId,
              webhookIds: installation.webhookIds,
              webhookExpiresAt,
              expectedWebhookIds: installation.webhookIds,
              expectedWebhookExpiresAt: installation.webhookExpiresAt,
            });
            if (!updated) {
              skipped += 1;
              continue;
            }
            renewed += 1;
          }
        } catch (error) {
          failed += 1;
          logger().warn(
            {err: error, connectionId: installation.connectionId},
            'Jira webhook renewal failed',
          );
        } finally {
          clearInterval(heartbeatInterval);
          heartbeat();
        }
      }

      return {renewed, reregistered, skipped, failed};
    },
  };
}

function isDueForRenewal(installation: JiraInstallation, renewalDeadline: Date): boolean {
  return (
    installation.status === 'installed' &&
    installation.webhookExpiresAt !== null &&
    installation.webhookExpiresAt.getTime() <= renewalDeadline.getTime()
  );
}
