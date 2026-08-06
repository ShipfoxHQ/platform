import {JIRA_PROVIDER} from '@shipfox/api-integration-jira-dto';
import {
  createJiraAgentToolsClient,
  createJiraApiClient,
  type JiraAgentToolsClient,
  type JiraApiClient,
} from '#api/client.js';
import {config} from '#config.js';
import {JiraAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {createJiraWebhookProcessor} from '#core/webhook-processor.js';
import {registerJiraWebhook} from '#core/webhook-registration.js';
import {closeDb, db} from '#db/db.js';
import {getJiraInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateJiraIntegrationRoutesOptions,
  createJiraIntegrationRoutes,
} from '#presentation/routes/install.js';
import {
  type CreateJiraWebhookRoutesOptions,
  createJiraWebhookRoutes,
  JIRA_WEBHOOK_ROUTE_PREFIX,
} from '#presentation/routes/webhooks.js';

const TRAILING_SLASHES_RE = /\/+$/;

export type {JiraProvider} from '@shipfox/api-integration-jira-dto';
export type {
  JiraAccessibleResource,
  JiraAgentToolHttpMethod,
  JiraAgentToolQueryValue,
  JiraAgentToolRequest,
  JiraAgentToolResponse,
  JiraAgentToolsClient,
  JiraApiClient,
  JiraAuthorization,
  JiraDynamicWebhookRegistration,
  JiraIdentity,
} from '#api/client.js';
export {
  createJiraAgentToolsClient,
  createJiraApiClient,
  JIRA_DYNAMIC_WEBHOOK_EVENTS,
  JIRA_DYNAMIC_WEBHOOK_JQL,
  mapJiraError,
} from '#api/client.js';
export type {
  JiraAgentToolCatalogEntry,
  JiraAgentToolId,
  JiraAgentToolRequiredScope,
} from '#core/agent-tools.js';
export {
  jiraAgentToolCatalog,
  jiraAgentToolSelectionCatalog,
  jiraPlainTextToAdf,
} from '#core/agent-tools.js';
export type {
  JiraAgentToolsProviderOptions,
  JiraToolCallResult,
} from '#core/agent-tools-provider.js';
export {JiraAgentToolsProvider} from '#core/agent-tools-provider.js';
export type {DisconnectJiraInstallationParams} from '#core/disconnect.js';
export {disconnectJiraInstallation} from '#core/disconnect.js';
export {
  JiraAccessTokenMissingError,
  JiraAuthorizationScopeMismatchError,
  JiraConnectionAlreadyLinkedError,
  JiraConnectionNotFoundError,
  JiraInstallationAlreadyLinkedError,
  JiraInstallationSiteMismatchError,
  JiraInstallStateActorMismatchError,
  JiraInstallStateError,
  JiraIntegrationProviderError,
  JiraOAuthCallbackError,
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
  JiraTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectJiraInstallationInput, HandleJiraCallbackParams} from '#core/install.js';
export {
  handleJiraCallback,
  handleJiraOAuthCallbackError,
  handleJiraSiteSelection,
} from '#core/install.js';
export type {JiraPendingSelectionSecretsStore, JiraPendingSelectionStore} from '#core/pending.js';
export {createJiraPendingSelectionStore, jiraPendingSecretsNamespace} from '#core/pending.js';
export {
  assertJiraAuthorizationScopes,
  formatJiraOAuthScopes,
  JIRA_OAUTH_SCOPES,
} from '#core/scopes.js';
export {signJiraInstallState, verifyJiraInstallState} from '#core/state.js';
export type {
  CreateJiraTokenStoreParams,
  GetJiraAccessTokenParams,
  JiraConnectionResolverResult,
  JiraSecretsStore,
  JiraTokenStore,
  StoreJiraTokensParams,
} from '#core/tokens.js';
export {createJiraTokenStore, jiraSecretsNamespace} from '#core/tokens.js';
export type {
  CreateJiraWebhookProcessorOptions,
  JiraWebhookProcessor,
} from '#core/webhook-processor.js';
export {createJiraWebhookProcessor} from '#core/webhook-processor.js';
export type {RegisterJiraWebhookParams} from '#core/webhook-registration.js';
export {JIRA_WEBHOOK_TTL_MS, registerJiraWebhook} from '#core/webhook-registration.js';
export type {
  JiraInstallation,
  JiraInstallationLock,
  JiraInstallationStatus,
  UpdateJiraInstallationWebhookParams,
  UpsertJiraInstallationParams,
} from '#db/installations.js';
export {
  deleteJiraInstallationByConnectionId,
  getJiraInstallationByCloudId,
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  listJiraInstallationsDueForTokenRefresh,
  markJiraInstallationRevoked,
  updateJiraInstallationTokenExpiry,
  updateJiraInstallationWebhook,
  upsertJiraInstallation,
  withJiraRefreshLock,
  withJiraRefreshLockAndWait,
  withJiraWebhookRegistrationLock,
} from '#db/installations.js';
export type {CreateJiraWebhookRoutesOptions} from '#presentation/routes/webhooks.js';
export {createJiraWebhookRoutes} from '#presentation/routes/webhooks.js';
export {createJiraMaintenanceWorker} from '#temporal/worker.js';
export {closeDb, config, db, migrationsPath};

export interface CreateJiraIntegrationProviderOptions {
  jira?: JiraApiClient | undefined;
  agentTools?:
    | {
        tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
        jira?: JiraAgentToolsClient | undefined;
      }
    | undefined;
  getJiraInstallationByConnectionId?: typeof getJiraInstallationByConnectionId | undefined;
  cleanup?:
    | {
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
  routes?: JiraIntegrationProviderRoutesOptions | undefined;
}

type JiraIntegrationProviderRoutesOptions = Omit<
  CreateJiraIntegrationRoutesOptions,
  'jira' | 'connectionCapabilities' | 'registerJiraWebhook'
> &
  Omit<CreateJiraWebhookRoutesOptions, 'processor'>;

export function createJiraIntegrationProvider(options: CreateJiraIntegrationProviderOptions = {}) {
  const jira = options.jira ?? createJiraApiClient();
  const getInstallationByConnectionId =
    options.getJiraInstallationByConnectionId ?? getJiraInstallationByConnectionId;
  const adapters = options.agentTools
    ? {
        agent_tools: new JiraAgentToolsProvider({
          jira: options.agentTools.jira ?? createJiraAgentToolsClient(),
          tokenStore: options.agentTools.tokenStore,
        }),
      }
    : {};
  const webhookOptions = toJiraWebhookOptions(options.routes);
  const webhookProcessor = webhookOptions ? createJiraWebhookProcessor(webhookOptions) : undefined;
  const webhookRoutes = webhookOptions
    ? [
        createJiraWebhookRoutes({
          coreDb: webhookOptions.coreDb,
          publishIntegrationEventReceived: webhookOptions.publishIntegrationEventReceived,
          recordDeliveryOnly: webhookOptions.recordDeliveryOnly,
          getIntegrationConnectionById: webhookOptions.getIntegrationConnectionById,
          processor: webhookProcessor,
        }),
      ]
    : [];
  const routes = options.routes
    ? [
        createJiraIntegrationRoutes({
          jira,
          connectionCapabilities: adapters.agent_tools ? ['agent_tools'] : [],
          ...options.routes,
          registerJiraWebhook: (input) =>
            registerJiraWebhook({
              jira,
              connectionId: input.connectionId,
              cloudId: input.cloudId,
              accessToken: input.accessToken,
              webhookUrl: jiraWebhookUrl(input.connectionId),
              ...(input.withRegistrationLock
                ? {withRegistrationLock: input.withRegistrationLock}
                : {}),
              ...(input.onRegistrationSuccess
                ? {onRegistrationSuccess: input.onRegistrationSuccess}
                : {}),
              ...(input.onRegistrationFailure
                ? {onRegistrationFailure: input.onRegistrationFailure}
                : {}),
            }).then(() => undefined),
        }),
        ...webhookRoutes,
      ]
    : [];
  return {
    provider: JIRA_PROVIDER,
    displayName: 'Jira',
    adapters,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      return (await getInstallationByConnectionId(connection.id))?.siteUrl;
    },
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['jira'] as const, processor: webhookProcessor}]
      : undefined,
  };
}

function jiraWebhookUrl(connectionId: string): string {
  return `${config.JIRA_WEBHOOK_BASE_URL.replace(TRAILING_SLASHES_RE, '')}${JIRA_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
}

function toJiraWebhookOptions(
  routes: CreateJiraIntegrationProviderOptions['routes'],
): CreateJiraWebhookRoutesOptions | undefined {
  if (!routes) return undefined;
  if (
    routes.coreDb === undefined ||
    routes.publishIntegrationEventReceived === undefined ||
    routes.recordDeliveryOnly === undefined ||
    routes.getIntegrationConnectionById === undefined
  )
    throw new Error(
      'Jira integration provider requires all webhook receiver dependencies: coreDb, publishIntegrationEventReceived, recordDeliveryOnly, and getIntegrationConnectionById',
    );
  return {
    coreDb: routes.coreDb,
    publishIntegrationEventReceived: routes.publishIntegrationEventReceived,
    recordDeliveryOnly: routes.recordDeliveryOnly,
    getIntegrationConnectionById: routes.getIntegrationConnectionById,
  };
}
