import {logger} from '@shipfox/node-opentelemetry';
import type {JiraApiClient} from '#api/client.js';
import {
  deleteJiraInstallationByConnectionId,
  getJiraInstallationByConnectionId,
  type JiraInstallation,
} from '#db/installations.js';
import type {JiraTokenStore} from './tokens.js';
import {jiraSecretsNamespace} from './tokens.js';

export interface DeregisterJiraWebhooksParams {
  connectionId: string;
  tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
  jira: Pick<JiraApiClient, 'deleteDynamicWebhooks'>;
  getInstallation?: (connectionId: string) => Promise<JiraInstallation | undefined>;
}

export async function prepareJiraWebhookDeregistration(
  params: DeregisterJiraWebhooksParams,
): Promise<(() => Promise<void>) | undefined> {
  try {
    const getInstallation = params.getInstallation ?? getJiraInstallationByConnectionId;
    const installation = await getInstallation(params.connectionId);
    if (!installation || installation.webhookIds.length === 0) return undefined;

    const accessToken = await params.tokenStore.getAccessToken({
      connectionId: params.connectionId,
      allowInactive: true,
    });
    return async () => {
      try {
        await params.jira.deleteDynamicWebhooks({
          accessToken,
          cloudId: installation.cloudId,
          webhookIds: installation.webhookIds,
        });
      } catch (error) {
        logger().warn(
          {err: error, connectionId: params.connectionId},
          'Jira webhook deregistration failed during disconnect',
        );
      }
    };
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira webhook deregistration preparation failed during disconnect',
    );
    return undefined;
  }
}

export async function deregisterJiraWebhooks(params: DeregisterJiraWebhooksParams): Promise<void> {
  const cleanup = await prepareJiraWebhookDeregistration(params);
  await cleanup?.();
}

export interface DisconnectJiraInstallationParams<Tx = unknown> {
  connectionId: string;
  getConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
  deregisterWebhooks?: (() => Promise<void>) | undefined;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  deleteConnection(params: {connectionId: string}, options: {tx: Tx}): Promise<boolean>;
}

export async function disconnectJiraInstallation<Tx = unknown>(
  params: DisconnectJiraInstallationParams<Tx>,
): Promise<void> {
  const connection = await params.getConnection(params.connectionId);
  try {
    await params.deregisterWebhooks?.();
  } catch (error) {
    logger().warn(
      {err: error, connectionId: params.connectionId},
      'Jira webhook deregistration hook failed during disconnect',
    );
  }
  if (connection)
    await params.deleteSecrets({
      workspaceId: connection.workspaceId,
      namespace: jiraSecretsNamespace(params.connectionId),
    });
  await params.transaction(async (tx) => {
    await deleteJiraInstallationByConnectionId(params.connectionId, {tx});
    await params.deleteConnection({connectionId: params.connectionId}, {tx});
  });
}
