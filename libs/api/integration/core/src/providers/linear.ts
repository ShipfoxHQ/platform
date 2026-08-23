import type {
  ConnectLinearInstallationInput,
  LinearSecretsStore,
} from '@shipfox/api-integration-linear';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const LINEAR_SECRETS_NAMESPACE_PREFIX = 'system/integrations/linear/';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];

async function loadLinearModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createLinearTokenStore,
    createLinearE2eRoutes,
    createLinearIntegrationProvider,
    config: linearConfig,
    deleteLinearInstallationByConnectionId,
    disconnectLinearInstallation: disconnectLinearInstallationRecords,
    getLinearInstallationByOrganizationId,
    db: linearDb,
    linearSecretsNamespace,
    migrationsPath: linearMigrationsPath,
    upsertLinearInstallation,
  } = await import('@shipfox/api-integration-linear');
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingLinearConnection(input: {
    organizationId: string;
  }): Promise<CoreIntegrationConnection<'linear'> | undefined> {
    const installation = await getLinearInstallationByOrganizationId(input.organizationId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'linear'>;
  }

  async function connectLinearInstallation(
    input: ConnectLinearInstallationInput,
  ): Promise<CoreIntegrationConnection<'linear'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`linear_${input.organizationUrlKey}`, {
          fallback: 'linear',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'linear',
            externalAccountId: input.organizationId,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'linear',
            externalAccountId: input.organizationId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          {tx},
        );

        await upsertLinearInstallation(
          {
            connectionId: connection.id,
            organizationId: input.organizationId,
            organizationUrlKey: input.organizationUrlKey,
            appUserId: input.appUserId,
            scopes: input.scopes,
            tokenExpiresAt: input.tokenExpiresAt,
            status: 'installed',
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'linear'>;
      }),
    );
  }

  async function disconnectLinearInstallation(input: {connectionId: string}): Promise<void> {
    await disconnectLinearInstallationRecords<IntegrationTx>({
      connectionId: input.connectionId,
      getConnection: getIntegrationConnectionById,
      deleteSecrets: (params) =>
        options.secrets?.linear?.deleteSecrets({
          ...params,
          namespace: linearNamespaceSuffix(params.namespace),
        }) ?? Promise.resolve(0),
      transaction: (fn) => db().transaction((tx) => fn(tx)),
      deleteConnection: (params, options) =>
        deleteIntegrationConnection({id: params.connectionId}, options),
    });
  }

  const fallbackSecrets: LinearSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Linear token storage is not configured')),
  };
  const secrets: LinearSecretsStore = options.secrets?.linear
    ? {
        getSecret: (params: Parameters<LinearSecretsStore['getSecret']>[0]) =>
          options.secrets?.linear?.getSecret({
            ...params,
            namespace: linearNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params: Parameters<LinearSecretsStore['setSecrets']>[0]) =>
          options.secrets?.linear?.setSecrets({
            ...params,
            namespace: linearNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
      }
    : fallbackSecrets;
  const tokenStore = createLinearTokenStore({
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
  });

  const integrationProvider = createLinearIntegrationProvider({
    agentTools: {tokenStore, endpoint: linearConfig.LINEAR_MCP_ENDPOINT},
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteLinearInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        // Scoped secrets accept the provider-local suffix, after this helper validates its prefix.
        await (options.secrets?.linear?.deleteSecrets({
          workspaceId: connection.workspaceId,
          namespace: linearNamespaceSuffix(linearSecretsNamespace(connection.id)),
        }) ?? Promise.resolve());
      },
    },
    routes: {
      tokenStore,
      getExistingLinearConnection,
      connectLinearInstallation,
      disconnectLinearInstallation,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      coreDb: db,
      ...(options.requireActiveWorkspaceMembership
        ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
        : {}),
    },
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    e2eRoutes: [
      createLinearE2eRoutes({
        tokenStore,
        getExistingLinearConnection,
        connectLinearInstallation,
        disconnectLinearInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    database: {
      db: linearDb,
      migrationsPath: linearMigrationsPath,
      databaseNamespace: 'integrations_linear',
    },
  };
}

export const linearProviderModule: IntegrationProviderModule = {
  id: 'linear',
  enabled: config.INTEGRATIONS_ENABLE_LINEAR_PROVIDER,
  load: loadLinearModuleParts,
};

function linearNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(LINEAR_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('Linear provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(LINEAR_SECRETS_NAMESPACE_PREFIX.length);
}
