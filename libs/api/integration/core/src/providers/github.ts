import type {ConnectGithubInstallationInput} from '@shipfox/api-integration-github';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {
  publishIntegrationEventReceived,
  publishSourcePush,
  publishSourceRepositoryUpdated,
  recordDeliveryOnly,
} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {
  IntegrationModuleParts,
  IntegrationProviderModule,
  IntegrationProviderModuleLoadOptions,
} from '#providers/types.js';

async function loadGithubModuleParts(
  options: IntegrationProviderModuleLoadOptions = {},
): Promise<IntegrationModuleParts> {
  const {
    createGithubInstallationTokenProvider,
    createGithubE2eRoutes,
    encodeInstallationTokenEnvelope,
    createGithubIntegrationProvider,
    getGithubInstallationByInstallationId,
    githubInstallationTokenNamespace,
    db: githubDb,
    migrationsPath: githubMigrationsPath,
    upsertGithubInstallation,
  } = await import('@shipfox/api-integration-github');

  const tokenProvider = createGithubInstallationTokenProvider({
    getIntegrationConnectionById,
    secretStore: options.secrets?.github
      ? {
          read: async (workspaceId, installationId) =>
            (await options.secrets?.github?.getSecret({
              workspaceId,
              namespace: githubInstallationTokenNamespace(installationId),
              key: 'envelope',
            })) ?? null,
          write: async (workspaceId, installationId, envelope) => {
            await options.secrets?.github?.setSecrets({
              workspaceId,
              namespace: githubInstallationTokenNamespace(installationId),
              values: {envelope: encodeInstallationTokenEnvelope(envelope)},
            });
          },
        }
      : undefined,
  });
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingGithubConnection(input: {
    installationId: string;
  }): Promise<CoreIntegrationConnection<'github'> | undefined> {
    const installation = await getGithubInstallationByInstallationId(input.installationId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'github'>;
  }

  async function connectGithubInstallation(
    input: ConnectGithubInstallationInput,
  ): Promise<CoreIntegrationConnection<'github'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`github_${input.installation.accountLogin}`, {
          fallback: 'github',
        });
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'github',
            externalAccountId: input.installationId,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'github',
            externalAccountId: input.installationId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          {tx},
        );

        await upsertGithubInstallation(
          {
            connectionId: connection.id,
            ...input.installation,
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'github'>;
      }),
    );
  }

  const integrationProvider = createGithubIntegrationProvider({
    getExistingGithubConnection,
    connectGithubInstallation,
    publishIntegrationEventReceived,
    publishSourceRepositoryUpdated,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    coreDb: db,
    deleteSecrets: options.secrets?.deleteSecrets,
    agentTools: {tokenProvider},
    ...(options.requireActiveWorkspaceMembership
      ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
      : {}),
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    e2eRoutes: [
      createGithubE2eRoutes({
        getExistingGithubConnection,
        connectGithubInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    database: {
      db: githubDb,
      migrationsPath: githubMigrationsPath,
      databaseNamespace: 'integrations_github',
    },
  };
}

export const githubProviderModule: IntegrationProviderModule = {
  id: 'github',
  enabled: config.INTEGRATIONS_ENABLE_GITHUB_PROVIDER,
  load: loadGithubModuleParts,
};
