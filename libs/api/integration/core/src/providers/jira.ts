import type {
  ConnectJiraInstallationInput,
  JiraPendingSelectionSecretsStore,
  JiraSecretsStore,
} from '@shipfox/api-integration-jira';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const JIRA_SECRETS_NAMESPACE_PREFIX = 'system/integrations/jira/';
type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

async function loadJiraModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createJiraApiClient,
    createJiraIntegrationProvider,
    createJiraMaintenanceWorker,
    createJiraPendingSelectionStore,
    createJiraTokenStore,
    db: jiraDb,
    deregisterJiraWebhooks,
    deleteJiraInstallationByConnectionId,
    disconnectJiraInstallation: disconnectJiraInstallationRecords,
    getJiraInstallationByCloudId,
    getJiraInstallationByConnectionId,
    jiraSecretsNamespace,
    jiraWebhookUrl,
    migrationsPath,
    prepareJiraWebhookDeregistration,
    upsertJiraInstallation,
    withJiraRefreshLockAndWait,
    withJiraWebhookRegistrationLock,
  } = await import('@shipfox/api-integration-jira');
  const jira = createJiraApiClient();
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingJiraConnection(input: {
    cloudId: string;
  }): Promise<CoreIntegrationConnection<'jira'> | undefined> {
    const installation = await getJiraInstallationByCloudId(input.cloudId);
    if (!installation) return undefined;
    return (await getIntegrationConnectionById(installation.connectionId)) as
      | CoreIntegrationConnection<'jira'>
      | undefined;
  }

  function connectJiraInstallation(
    input: ConnectJiraInstallationInput,
  ): Promise<CoreIntegrationConnection<'jira'>> {
    return retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'jira',
            externalAccountId: input.cloudId,
            baseSlug: slugifyConnectionSlug(`jira_${input.siteName || input.cloudId}`, {
              fallback: 'jira',
            }),
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'jira',
            externalAccountId: input.cloudId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          {tx},
        );
        await upsertJiraInstallation(
          {
            connectionId: connection.id,
            cloudId: input.cloudId,
            siteUrl: input.siteUrl,
            siteName: input.siteName,
            authorizingAccountId: input.authorizingAccountId,
            scopes: input.scopes,
            status: 'installed',
            tokenExpiresAt: input.tokenExpiresAt,
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'jira'>;
      }),
    );
  }

  async function disconnectJiraInstallation(input: {
    connectionId: string;
    lockAlreadyHeld?: boolean | undefined;
  }): Promise<void> {
    const disconnect = () =>
      disconnectJiraInstallationRecords<IntegrationTx>({
        connectionId: input.connectionId,
        getConnection: getIntegrationConnectionById,
        deleteSecrets: (params) =>
          options.secrets?.jira?.deleteSecrets({
            ...params,
            namespace: jiraNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(0),
        deregisterWebhooks: () =>
          deregisterJiraWebhooks({
            connectionId: input.connectionId,
            getInstallation: getJiraInstallationByConnectionId,
            tokenStore,
            jira,
          }),
        transaction: (fn) => db().transaction((tx) => fn(tx)),
        deleteConnection: (params, transactionOptions) =>
          deleteIntegrationConnection({id: params.connectionId}, transactionOptions),
      });
    if (input.lockAlreadyHeld) {
      await disconnect();
      return;
    }
    const installation = await getJiraInstallationByConnectionId(input.connectionId);
    if (!installation) {
      await disconnect();
      return;
    }
    await withJiraWebhookRegistrationLock(installation.cloudId, disconnect);
  }

  const fallbackSecrets: JiraSecretsStore & JiraPendingSelectionSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Jira token storage is not configured')),
    deleteSecrets: () => Promise.resolve(0),
  };
  const secrets: JiraSecretsStore & JiraPendingSelectionSecretsStore = options.secrets?.jira
    ? {
        getSecret: (params) =>
          options.secrets?.jira?.getSecret({
            ...params,
            namespace: jiraNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params) =>
          options.secrets?.jira?.setSecrets({
            ...params,
            namespace: jiraNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
        deleteSecrets: (params) =>
          options.secrets?.jira?.deleteSecrets({
            ...params,
            namespace: jiraNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(0),
      }
    : fallbackSecrets;
  const tokenStore = createJiraTokenStore({
    client: jira,
    resolveConnection: getIntegrationConnectionById,
    secrets,
    markConnectionError: async ({connectionId}) => {
      await updateIntegrationConnectionLifecycleStatus({
        id: connectionId,
        lifecycleStatus: 'error',
      });
    },
  });
  const pendingStore = createJiraPendingSelectionStore({secrets});

  const integrationProvider = createJiraIntegrationProvider({
    jira,
    agentTools: {tokenStore},
    cleanup: {
      deleteConnectionRemoteResources: async (connection) => {
        return await prepareJiraWebhookDeregistration({
          connectionId: connection.id,
          getInstallation: getJiraInstallationByConnectionId,
          tokenStore,
          jira,
        });
      },
      withConnectionDeletionLock: async (connection, fn) => {
        const installation = await getJiraInstallationByConnectionId(connection.id);
        if (!installation) {
          await fn();
          return;
        }
        await withJiraWebhookRegistrationLock(installation.cloudId, fn);
      },
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteJiraInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        await withJiraRefreshLockAndWait(connection.id, async () => {
          // Scoped secrets accept the provider-local suffix, after this helper validates its prefix.
          await (options.secrets?.jira?.deleteSecrets({
            workspaceId: connection.workspaceId,
            namespace: jiraNamespaceSuffix(jiraSecretsNamespace(connection.id)),
          }) ?? Promise.resolve());
        });
      },
    },
    routes: {
      tokenStore,
      pendingStore,
      getExistingJiraConnection,
      connectJiraInstallation,
      disconnectJiraInstallation,
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      markConnectionActive: async ({connectionId, tx}) => {
        await updateIntegrationConnectionLifecycleStatus(
          {
            id: connectionId,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          tx === undefined ? {} : {tx: tx as IntegrationTx},
        );
      },
      markConnectionError: async ({connectionId, tx}) => {
        await updateIntegrationConnectionLifecycleStatus(
          {
            id: connectionId,
            lifecycleStatus: 'error',
          },
          tx === undefined ? {} : {tx: tx as IntegrationTx},
        );
      },
      ...(options.requireActiveWorkspaceMembership
        ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
        : {}),
    },
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    workers: [
      createJiraMaintenanceWorker({
        jira,
        tokenStore,
        resolveConnection: getIntegrationConnectionById,
        webhookUrlForConnection: jiraWebhookUrl,
      }),
    ],
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {db: jiraDb, migrationsPath, databaseNamespace: 'integrations_jira'},
  };
}

export const jiraProviderModule: IntegrationProviderModule = {
  id: 'jira',
  enabled: config.INTEGRATIONS_ENABLE_JIRA_PROVIDER,
  load: loadJiraModuleParts,
};

function jiraNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(JIRA_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('Jira provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(JIRA_SECRETS_NAMESPACE_PREFIX.length);
}
