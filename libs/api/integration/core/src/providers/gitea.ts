import type {ConnectGiteaConnectionInput} from '@shipfox/api-integration-gitea';
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
import {publishSourcePush, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadGiteaModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createGiteaIntegrationProvider,
    getGiteaConnectionByOrg,
    upsertGiteaConnection,
    db: giteaDb,
    migrationsPath: giteaMigrationsPath,
  } = await import('@shipfox/api-integration-gitea');
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingGiteaConnection(input: {
    org: string;
  }): Promise<CoreIntegrationConnection<'gitea'> | undefined> {
    const row = await getGiteaConnectionByOrg(input.org);
    if (!row) return undefined;
    const connection = await getIntegrationConnectionById(row.connectionId);
    if (!connection) return undefined;
    return connection as CoreIntegrationConnection<'gitea'>;
  }

  async function connectGiteaConnection(
    input: ConnectGiteaConnectionInput,
  ): Promise<CoreIntegrationConnection<'gitea'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const baseSlug = slugifyConnectionSlug(`gitea_${input.org}`, {fallback: 'gitea'});
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'gitea',
            externalAccountId: input.org,
            baseSlug,
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'gitea',
            externalAccountId: input.org,
            slug,
            displayName: input.displayName,
            lifecycleStatus: 'active',
            capabilities: providerCapabilities,
          },
          {tx},
        );

        await upsertGiteaConnection(
          {
            connectionId: connection.id,
            org: input.org,
          },
          {tx},
        );

        return connection as CoreIntegrationConnection<'gitea'>;
      }),
    );
  }

  const integrationProvider = createGiteaIntegrationProvider({
    getExistingGiteaConnection,
    connectGiteaConnection,
    publishSourcePush,
    recordDeliveryOnly,
    getIntegrationConnectionById,
    coreDb: db,
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {
      db: giteaDb,
      migrationsPath: giteaMigrationsPath,
      databaseNamespace: 'integrations_gitea',
    },
  };
}

export const giteaProviderModule: IntegrationProviderModule = {
  id: 'gitea',
  enabled: config.INTEGRATIONS_ENABLE_GITEA_PROVIDER,
  load: loadGiteaModuleParts,
};
