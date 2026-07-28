import type {JiraWebhookEnvelopeDto} from '@shipfox/api-integration-jira-dto';
import type {
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import type {JiraInstallation} from '#db/installations.js';

const JIRA_PROVIDER = 'jira';

export interface HandleJiraWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  receivedAt: string;
  rawPayload: JiraWebhookEnvelopeDto;
  cloudId: string;
  connection: IntegrationConnection<'jira'>;
  authorizingAccountId: string;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
}

export type HandleJiraWebhookResult = 'published' | 'duplicate' | 'discarded';

export async function handleJiraWebhook(
  params: HandleJiraWebhookParams,
): Promise<HandleJiraWebhookResult> {
  if (isSelfAuthoredEvent(params.rawPayload, params.authorizingAccountId)) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: JIRA_PROVIDER,
      deliveryId: params.deliveryId,
    });
    return 'discarded';
  }

  const payload = {...params.rawPayload, cloudId: params.cloudId};
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: JIRA_PROVIDER,
      source: params.connection.slug,
      event: params.rawPayload.webhookEvent,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: params.receivedAt,
      payload,
    },
  });
  return result.published ? 'published' : 'duplicate';
}

function isSelfAuthoredEvent(payload: JiraWebhookEnvelopeDto, authorizingAccountId: string) {
  return (
    (payload.webhookEvent === 'comment_created' ||
      payload.webhookEvent === 'comment_updated' ||
      payload.webhookEvent === 'jira:issue_updated') &&
    payload.user.accountId === authorizingAccountId
  );
}

export function isJiraInstallationUsable(
  installation: JiraInstallation | undefined,
): installation is JiraInstallation {
  return installation?.status === 'installed';
}
