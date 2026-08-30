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
          const outcome = await renewJiraWebhook({
            options,
            installation,
            renewalDeadline,
            now,
            updateInstallation,
            registerWebhook,
          });
          if (outcome === 'renewed') renewed += 1;
          if (outcome === 'reregistered') reregistered += 1;
          if (outcome === 'skipped') skipped += 1;
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

type JiraWebhookRenewalOutcome = 'renewed' | 'reregistered' | 'skipped';

async function renewJiraWebhook(params: {
  options: CreateJiraWebhookRenewalActivitiesOptions;
  installation: JiraInstallation;
  renewalDeadline: Date;
  now: () => Date;
  updateInstallation: typeof updateJiraInstallationWebhookIfUnchanged;
  registerWebhook: typeof registerJiraWebhook;
}): Promise<JiraWebhookRenewalOutcome> {
  if (!isDueForRenewal(params.installation, params.renewalDeadline)) return 'skipped';
  const connection = await params.options.resolveConnection(params.installation.connectionId);
  if (connection?.lifecycleStatus !== 'active') return 'skipped';
  const jira = params.options.jira;
  const webhookUrlForConnection = params.options.webhookUrlForConnection;
  if (!jira || !webhookUrlForConnection) {
    throw new Error('Jira webhook renewal dependencies are not configured');
  }
  const accessToken = await params.options.tokenStore.getAccessToken({
    connectionId: params.installation.connectionId,
  });
  const webhookExpiresAt = await refreshJiraWebhook(jira, params.installation, accessToken);
  if (webhookExpiresAt === undefined) {
    await params.registerWebhook({
      jira,
      connectionId: params.installation.connectionId,
      cloudId: params.installation.cloudId,
      accessToken,
      webhookUrl: webhookUrlForConnection(params.installation.connectionId),
      now: params.now,
      replaceExistingWebhooks: true,
    });
    return 'reregistered';
  }
  const updated = await params.updateInstallation({
    connectionId: params.installation.connectionId,
    webhookIds: params.installation.webhookIds,
    webhookExpiresAt,
    expectedWebhookIds: params.installation.webhookIds,
    expectedWebhookExpiresAt: params.installation.webhookExpiresAt,
  });
  return updated ? 'renewed' : 'skipped';
}

function refreshJiraWebhook(
  jira: NonNullable<CreateJiraWebhookRenewalActivitiesOptions['jira']>,
  installation: JiraInstallation,
  accessToken: string,
): Promise<Date | undefined> {
  if (installation.webhookIds.length === 0) return Promise.resolve(undefined);
  return jira.refreshDynamicWebhooks({
    accessToken,
    cloudId: installation.cloudId,
    webhookIds: installation.webhookIds,
  });
}

function isDueForRenewal(installation: JiraInstallation, renewalDeadline: Date): boolean {
  return (
    installation.status === 'installed' &&
    installation.webhookExpiresAt !== null &&
    installation.webhookExpiresAt.getTime() <= renewalDeadline.getTime()
  );
}
