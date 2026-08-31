import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  PublishSourceRepositoryUpdatedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGithubApiClient, type GithubApiClient} from '#api/client.js';
import type {GithubCheckoutTokenCachePort} from '#api/github-checkout-token-cache.js';
import type {GithubInstallationTokenProvider} from '#api/installation-token-provider.js';
import {
  createGithubInstallationTokenProvider,
  deleteGithubInstallationTokenSecret,
} from '#api/installation-token-provider.js';
import {GithubAgentToolsProvider} from '#core/agent-tools.js';
import {GithubSourceControlProvider} from '#core/source-control.js';
import {createGithubWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {
  getGithubInstallationByConnectionId,
  getGithubInstallationByInstallationId,
} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateGithubE2eRoutesOptions,
  createGithubE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
import {
  type CreateGithubIntegrationRoutesOptions,
  createGithubIntegrationRoutes,
} from '#presentation/routes/install.js';
import {createGithubWebhookRoutes} from '#presentation/routes/webhooks.js';

const GITHUB_INSTALLATION_ID_PATTERN = /^[1-9]\d*$/u;

export type {GithubApiClient} from '#api/client.js';
export {
  type GithubCheckoutToken,
  GithubCheckoutTokenCache,
  type GithubCheckoutTokenCachePort,
  type GithubCheckoutTokenPermissions,
  type GithubCheckoutTokenScope,
} from '#api/github-checkout-token-cache.js';
export {
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenKey,
  githubInstallationTokenNamespace,
} from '#api/installation-token-envelope.js';
export {
  createGithubInstallationTokenProvider,
  type GithubInstallationTokenProvider,
} from '#api/installation-token-provider.js';
export {
  type AgentToolRepositoryScope,
  type AgentToolRepositoryScopeClassifier,
  type AgentToolRepositoryTarget,
  type GithubAgentToolCatalogEntry,
  type GithubAgentToolCategory,
  type GithubAgentToolId,
  type GithubAgentToolPermission,
  type GithubAgentToolPermissionAccess,
  type GithubAgentToolRequiredPermission,
  type GithubAgentToolRequiredScope,
  GithubAgentToolsProvider,
  githubAgentToolCatalog,
  githubAgentToolSelectionCatalog,
  githubRepositoryScope,
} from '#core/agent-tools.js';
export {GithubIntegrationProviderError} from '#core/errors.js';
export type {ConnectGithubInstallationInput} from '#core/install.js';
export {handleGithubCallback} from '#core/install.js';
export {signGithubInstallState, verifyGithubInstallState} from '#core/state.js';
export type {HandleGithubEventOutcome} from '#core/webhook.js';
export {handleGithubEvent} from '#core/webhook.js';
export type {
  CreateGithubWebhookProcessorOptions,
  GithubWebhookProcessor,
} from '#core/webhook-processor.js';
export {createGithubWebhookProcessor} from '#core/webhook-processor.js';
export type {GithubInstallation, UpsertGithubInstallationParams} from '#db/installations.js';
export {
  getGithubInstallationByConnectionId,
  getGithubInstallationByInstallationId,
  upsertGithubInstallation,
} from '#db/installations.js';
export {type CreateGithubE2eRoutesOptions, closeDb, createGithubE2eRoutes, db, migrationsPath};

export interface CreateGithubIntegrationProviderOptions
  extends Omit<CreateGithubIntegrationRoutesOptions, 'github'> {
  github?: GithubApiClient | undefined;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourceRepositoryUpdated: PublishSourceRepositoryUpdatedFn;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getGithubInstallationByConnectionId?: typeof getGithubInstallationByConnectionId | undefined;
  getGithubInstallationByInstallationId?: typeof getGithubInstallationByInstallationId | undefined;
  deleteSecrets?:
    | ((params: {workspaceId: string; namespace: string}) => Promise<number>)
    | undefined;
  agentTools?: {tokenProvider: GithubInstallationTokenProvider} | undefined;
  /** Optional exact-scope cache seam; omitted until checkout-cache activation. */
  checkoutTokenCache?: GithubCheckoutTokenCachePort | undefined;
}

export function createGithubIntegrationProvider(options: CreateGithubIntegrationProviderOptions) {
  const github = options.github ?? createGithubApiClient();
  const getInstallationByConnectionId =
    options.getGithubInstallationByConnectionId ?? getGithubInstallationByConnectionId;
  const deleteSecrets = options.deleteSecrets;
  const deleteInstallationTokenSecret = deleteSecrets
    ? (params: {workspaceId: string; installationId: number}) =>
        deleteGithubInstallationTokenSecret({
          workspaceId: params.workspaceId,
          installationId: params.installationId,
          deleteSecrets,
        })
    : undefined;
  const deleteConnectionSecrets = deleteSecrets
    ? async (connection: IntegrationConnection<'github'>): Promise<void> => {
        const {externalAccountId} = connection;
        if (!GITHUB_INSTALLATION_ID_PATTERN.test(externalAccountId)) {
          throw new Error(`Invalid GitHub installation id: ${externalAccountId}`);
        }
        const installationId = Number(externalAccountId);
        if (!Number.isSafeInteger(installationId)) {
          throw new Error(`Invalid GitHub installation id: ${externalAccountId}`);
        }
        await deleteGithubInstallationTokenSecret({
          workspaceId: connection.workspaceId,
          installationId,
          deleteSecrets,
        });
      }
    : undefined;
  const webhookProcessor = createGithubWebhookProcessor({
    ...options,
    deleteInstallationTokenSecret,
  });

  return {
    provider: 'github' as const,
    displayName: 'GitHub',
    // Classification is dark until the final repository-authorization cutover.
    repositoryAuthorization: 'unclassified' as const,
    eventCatalog: githubEventCatalog,
    adapters: {
      source_control: new GithubSourceControlProvider(
        github,
        undefined,
        options.checkoutTokenCache,
      ),
      agent_tools: new GithubAgentToolsProvider({
        getInstallationByConnectionId: getInstallationByConnectionId,
        tokenProvider:
          options.agentTools?.tokenProvider ??
          createGithubInstallationTokenProvider({
            getGithubInstallationByInstallationId:
              options.getGithubInstallationByInstallationId ??
              getGithubInstallationByInstallationId,
          }),
      }),
    },
    ...(deleteConnectionSecrets ? {deleteConnectionSecrets} : {}),
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      const installationId = encodeURIComponent(installation.installationId);
      if (installation.accountType === 'Organization') {
        const login = encodeURIComponent(installation.accountLogin);
        return `https://github.com/organizations/${login}/settings/installations/${installationId}`;
      }
      return `https://github.com/settings/installations/${installationId}`;
    },
    routes: [
      createGithubIntegrationRoutes({
        github,
        getExistingGithubConnection: options.getExistingGithubConnection,
        connectGithubInstallation: options.connectGithubInstallation,
        ...(options.requireActiveWorkspaceMembership
          ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
          : {}),
      }),
      createGithubWebhookRoutes({
        coreDb: options.coreDb,
        publishIntegrationEventReceived: options.publishIntegrationEventReceived,
        publishSourceRepositoryUpdated: options.publishSourceRepositoryUpdated,
        publishSourcePush: options.publishSourcePush,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
        deleteInstallationTokenSecret,
        processor: webhookProcessor,
      }),
    ],
    webhookProcessors: [{routeIds: ['github'] as const, processor: webhookProcessor}],
  };
}
