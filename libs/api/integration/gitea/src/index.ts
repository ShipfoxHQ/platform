import {giteaEventCatalog, giteaProviderKind} from '@shipfox/api-integration-gitea-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishSourcePushFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGiteaApiClient, type GiteaApiClient} from '#api/client.js';
import type {ConnectGiteaConnectionInput} from '#core/connect.js';
import {giteaConnectionExternalUrl} from '#core/connection-url.js';
import {GiteaSourceControlProvider} from '#core/source-control.js';
import {createGiteaWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {createGiteaConnectionRoutes} from '#presentation/routes/connections.js';
import {createGiteaWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {
  GiteaApiClient,
  GiteaFileContent,
  GiteaRepository,
  GiteaRepositoryPage,
  GiteaTree,
  GiteaTreeBlob,
} from '#api/client.js';
export {createGiteaApiClient} from '#api/client.js';
export type {ConnectGiteaConnectionInput} from '#core/connect.js';
export {handleGiteaConnect} from '#core/connect.js';
export {
  GiteaIntegrationProviderError,
  GiteaOrgAlreadyLinkedError,
  GiteaOrganizationNotFoundError,
} from '#core/errors.js';
export {GiteaSourceControlProvider} from '#core/source-control.js';
export type {
  CreateGiteaWebhookProcessorOptions,
  GiteaWebhookProcessor,
} from '#core/webhook-processor.js';
export {createGiteaWebhookProcessor} from '#core/webhook-processor.js';
export type {GiteaConnection, UpsertGiteaConnectionParams} from '#db/connections.js';
export {
  getGiteaConnectionByConnectionId,
  getGiteaConnectionByOrg,
  upsertGiteaConnection,
} from '#db/connections.js';
export {closeDb, db, migrationsPath};

export interface CreateGiteaIntegrationProviderOptions {
  gitea?: GiteaApiClient | undefined;
  getExistingGiteaConnection: (input: {
    org: string;
  }) => Promise<IntegrationConnection<'gitea'> | undefined>;
  connectGiteaConnection: (
    input: ConnectGiteaConnectionInput,
  ) => Promise<IntegrationConnection<'gitea'>>;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createGiteaIntegrationProvider(options: CreateGiteaIntegrationProviderOptions) {
  const gitea = options.gitea ?? createGiteaApiClient();
  const webhookProcessor = createGiteaWebhookProcessor(options);

  return {
    provider: giteaProviderKind,
    displayName: 'Gitea',
    eventCatalog: giteaEventCatalog,
    adapters: {
      source_control: new GiteaSourceControlProvider(gitea),
    },
    connectionExternalUrl(connection: {externalAccountId: string}): Promise<string | undefined> {
      return Promise.resolve(giteaConnectionExternalUrl(connection.externalAccountId));
    },
    routes: [
      createGiteaConnectionRoutes({
        gitea,
        getExistingGiteaConnection: options.getExistingGiteaConnection,
        connectGiteaConnection: options.connectGiteaConnection,
      }),
      createGiteaWebhookRoutes({
        coreDb: options.coreDb,
        publishSourcePush: options.publishSourcePush,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        processor: webhookProcessor,
      }),
    ],
    webhookProcessors: [{routeIds: ['gitea'] as const, processor: webhookProcessor}],
  };
}
