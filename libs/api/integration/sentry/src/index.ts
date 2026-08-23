import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  UpdateIntegrationConnectionLifecycleStatusFn,
} from '@shipfox/api-integration-spi';
import type {ModuleWorker} from '@shipfox/node-module';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createSentryApiClient, type SentryApiClient} from '#api/client.js';
import {createSentryWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {
  getSentryInstallationByConnectionId,
  persistVerifiedUnclaimedInstallation,
} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateSentryIntegrationRoutesOptions,
  createSentryIntegrationRoutes,
} from '#presentation/routes/install.js';
import {createSentryWebhookRoutes} from '#presentation/routes/webhooks.js';
import {createSentryMaintenanceActivities} from '#temporal/activities/index.js';
import {SENTRY_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export type {SentryApiClient} from '#api/client.js';
export {
  SentryClaimProofMismatchError,
  SentryInstallationAlreadyLinkedError,
  SentryInstallationDeletedError,
  SentryIntegrationProviderError,
  SentryVerificationInProgressError,
} from '#core/errors.js';
export type {
  ConnectSentryInstallationInput,
  VerifyAndPersistUnclaimedInstallationParams,
} from '#core/install.js';
export {
  handleSentryConnect,
  hashAuthorizationCode,
  verifyAndPersistUnclaimedInstallation,
} from '#core/install.js';
export {
  handleSentryInstallationCreated,
  handleSentryInstallationDeleted,
  handleSentryIssueEvent,
} from '#core/webhook.js';
export type {
  CreateSentryWebhookProcessorOptions,
  SentryWebhookProcessor,
} from '#core/webhook-processor.js';
export {createSentryWebhookProcessor} from '#core/webhook-processor.js';
export type {
  PersistVerifiedUnclaimedInstallationParams,
  SentryInstallation,
  SentryInstallationStatus,
  UpsertSentryInstallationParams,
} from '#db/installations.js';
export {
  getSentryInstallationByInstallationUuid,
  persistVerifiedUnclaimedInstallation,
  upsertSentryInstallation,
} from '#db/installations.js';
export {closeDb, db, migrationsPath};

export interface CreateSentryIntegrationProviderOptions
  extends Omit<
    CreateSentryIntegrationRoutesOptions,
    'sentry' | 'persistVerifiedUnclaimedInstallation'
  > {
  sentry?: SentryApiClient | undefined;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
  getSentryInstallationByConnectionId?: typeof getSentryInstallationByConnectionId | undefined;
  persistVerifiedUnclaimedInstallation?: typeof persistVerifiedUnclaimedInstallation | undefined;
}

export function createSentryIntegrationProvider(options: CreateSentryIntegrationProviderOptions) {
  const sentry = options.sentry ?? createSentryApiClient();
  const getInstallationByConnectionId =
    options.getSentryInstallationByConnectionId ?? getSentryInstallationByConnectionId;
  const persistUnclaimed =
    options.persistVerifiedUnclaimedInstallation ?? persistVerifiedUnclaimedInstallation;
  const webhookProcessor = createSentryWebhookProcessor({
    sentry,
    coreDb: options.coreDb,
    publishIntegrationEventReceived: options.publishIntegrationEventReceived,
    recordDeliveryOnly: options.recordDeliveryOnly,
    getIntegrationConnectionById: options.getIntegrationConnectionById,
    updateConnectionLifecycleStatus: options.updateConnectionLifecycleStatus,
  });

  return {
    provider: 'sentry' as const,
    displayName: 'Sentry',
    eventCatalog: sentryEventCatalog,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation?.orgSlug) return undefined;
      return `https://sentry.io/organizations/${encodeURIComponent(installation.orgSlug)}/`;
    },
    routes: [
      createSentryIntegrationRoutes({
        sentry,
        getSentryInstallation: options.getSentryInstallation,
        getConnectionById: options.getConnectionById,
        connectSentryInstallation: options.connectSentryInstallation,
        persistVerifiedUnclaimedInstallation: persistUnclaimed,
      }),
      createSentryWebhookRoutes({
        sentry,
        coreDb: options.coreDb,
        publishIntegrationEventReceived: options.publishIntegrationEventReceived,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        updateConnectionLifecycleStatus: options.updateConnectionLifecycleStatus,
        processor: webhookProcessor,
      }),
    ],
    webhookProcessors: [{routeIds: ['sentry'] as const, processor: webhookProcessor}],
  };
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintenanceWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export function createSentryMaintenanceWorker(): ModuleWorker {
  return {
    taskQueue: SENTRY_MAINTENANCE_TASK_QUEUE,
    workflowsPath: maintenanceWorkflowsPath,
    activities: createSentryMaintenanceActivities,
    workflows: [
      {
        name: 'pruneUnclaimedSentryInstallationsCron',
        id: 'sentry-prune-unclaimed-installations',
        cronSchedule: '0 4 * * *',
      },
    ],
  };
}
