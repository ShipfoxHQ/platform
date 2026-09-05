import {githubEventCatalog} from '@shipfox/api-integration-github-dto';
import type {
  AgentToolRepositoryAuthorizationState,
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  PublishSourceRepositoryUpdatedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGithubApiClient, type GithubApiClient} from '#api/client.js';
import {
  deleteGithubCheckoutTokenSecretGroup,
  type GithubCheckoutTokenCachePort,
  githubProviderInstanceFingerprint,
} from '#api/github-checkout-token-cache.js';
import type {GithubInstallationTokenProvider} from '#api/installation-token-provider.js';
import {
  createGithubInstallationTokenProvider,
  deleteGithubInstallationTokenSecret,
} from '#api/installation-token-provider.js';
import {config, normalizedGithubApiBaseUrl} from '#config.js';
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
  createGithubCheckoutTokenCache,
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
  /** The composed integrations module controls when repository authorization is live. */
  repositoryAuthorization?: AgentToolRepositoryAuthorizationState | undefined;
  /** Invalidates local repository authorization decisions after a committed webhook mutation. */
  invalidateRepositoryAuthorizationCache?: ((connectionId: string) => void) | undefined;
  getGithubInstallationByConnectionId?: typeof getGithubInstallationByConnectionId | undefined;
  getGithubInstallationByInstallationId?: typeof getGithubInstallationByInstallationId | undefined;
  deleteSecrets?:
    | ((params: {workspaceId: string; namespace: string}) => Promise<number>)
    | undefined;
  agentTools?: {tokenProvider: GithubInstallationTokenProvider} | undefined;
  /** Optional exact-scope cache for credential-only checkout delivery. */
  checkoutTokenCache?: GithubCheckoutTokenCachePort | undefined;
}

export function createGithubIntegrationProvider(options: CreateGithubIntegrationProviderOptions) {
  const github = options.github ?? createGithubApiClient();
  const getInstallationByConnectionId =
    options.getGithubInstallationByConnectionId ?? getGithubInstallationByConnectionId;
  const deleteSecrets = options.deleteSecrets;
  const checkoutTokenCache = options.checkoutTokenCache;
  const installationTokenProvider =
    options.agentTools?.tokenProvider ??
    createGithubInstallationTokenProvider({
      getGithubInstallationByInstallationId:
        options.getGithubInstallationByInstallationId ?? getGithubInstallationByInstallationId,
    });
  const checkoutTokenProviderInstance =
    deleteSecrets || checkoutTokenCache
      ? githubProviderInstanceFingerprint(normalizedGithubApiBaseUrl(), config.GITHUB_APP_ID)
      : undefined;
  const deleteInstallationSecrets =
    deleteSecrets || checkoutTokenCache
      ? async (params: {workspaceId: string; installationId: number}): Promise<number> => {
          let deletedEntries =
            (await installationTokenProvider.deleteInstallation?.(params.installationId)) ?? 0;
          if (deleteSecrets) {
            deletedEntries += await deleteGithubInstallationTokenSecret({
              workspaceId: params.workspaceId,
              installationId: params.installationId,
              deleteSecrets,
            });
          }
          const cleanup: Promise<number>[] = [];
          if (checkoutTokenProviderInstance) {
            cleanup.push(
              (async () => {
                const deleted = checkoutTokenCache?.deleteInstallation
                  ? await checkoutTokenCache.deleteInstallation(
                      params.workspaceId,
                      checkoutTokenProviderInstance,
                      params.installationId,
                    )
                  : 0;
                // A cache without a shared store can still evict its RAM copy but
                // must fall through to the authoritative namespace deletion.
                if (deleted === 0 && deleteSecrets) {
                  return await deleteGithubCheckoutTokenSecretGroup({
                    workspaceId: params.workspaceId,
                    providerInstance: checkoutTokenProviderInstance,
                    installationId: params.installationId,
                    deleteSecrets,
                  });
                }
                return deleted;
              })(),
            );
          }
          const deleted = await Promise.all(cleanup);
          return deletedEntries + deleted.reduce((total, count) => total + count, 0);
        }
      : undefined;
  const deleteInstallationTokenSecret = deleteInstallationSecrets
    ? (params: {workspaceId: string; installationId: number}) => deleteInstallationSecrets(params)
    : undefined;
  const deleteConnectionSecrets = deleteInstallationSecrets
    ? async (connection: IntegrationConnection<'github'>): Promise<void> => {
        const {externalAccountId} = connection;
        if (!GITHUB_INSTALLATION_ID_PATTERN.test(externalAccountId)) {
          throw new Error(`Invalid GitHub installation id: ${externalAccountId}`);
        }
        const installationId = Number(externalAccountId);
        if (!Number.isSafeInteger(installationId)) {
          throw new Error(`Invalid GitHub installation id: ${externalAccountId}`);
        }
        await deleteInstallationSecrets({
          workspaceId: connection.workspaceId,
          installationId,
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
    repositoryAuthorization: options.repositoryAuthorization ?? 'unclassified',
    eventCatalog: githubEventCatalog,
    adapters: {
      source_control: new GithubSourceControlProvider(github, undefined, checkoutTokenCache),
      agent_tools: new GithubAgentToolsProvider({
        getInstallationByConnectionId: getInstallationByConnectionId,
        tokenProvider: installationTokenProvider,
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
