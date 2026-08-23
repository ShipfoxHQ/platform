import {LINEAR_PROVIDER, linearEventCatalog} from '@shipfox/api-integration-linear-dto';
import {createLinearApiClient, type LinearApiClient} from '#api/client.js';
import {config} from '#config.js';
import {LinearAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {createLinearWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {getLinearInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateLinearIntegrationRoutesOptions,
  createLinearIntegrationRoutes,
} from '#presentation/routes/install.js';
import {
  type CreateLinearWebhookRoutesOptions,
  createLinearWebhookRoutes,
} from '#presentation/routes/webhooks.js';

export type {LinearProvider} from '@shipfox/api-integration-linear-dto';
export type {LinearApiClient, LinearAuthorization, LinearIdentity} from '#api/client.js';
export {createLinearApiClient} from '#api/client.js';
export type {
  LinearAgentToolCatalogEntry,
  LinearAgentToolCategory,
  LinearAgentToolId,
  LinearAgentToolRequiredScope,
} from '#core/agent-tools.js';
export {
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export {
  type DisconnectLinearInstallationParams,
  disconnectLinearInstallation,
} from '#core/disconnect.js';
export {
  LinearAccessTokenMissingError,
  LinearAuthorizationScopeMismatchError,
  LinearConnectionAlreadyLinkedError,
  LinearConnectionNotFoundError,
  LinearInstallationAlreadyLinkedError,
  LinearInstallStateActorMismatchError,
  LinearInstallStateError,
  LinearIntegrationProviderError,
  LinearOAuthCallbackError,
  LinearTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectLinearInstallationInput, HandleLinearCallbackParams} from '#core/install.js';
export {handleLinearCallback, handleLinearOAuthCallbackError} from '#core/install.js';
export {
  assertLinearAuthorizationScopes,
  formatLinearOAuthScopes,
  LINEAR_OAUTH_SCOPES,
} from '#core/scopes.js';
export type {LinearInstallStateClaims} from '#core/state.js';
export {signLinearInstallState, verifyLinearInstallState} from '#core/state.js';
export type {
  CreateLinearTokenStoreParams,
  GetLinearAccessTokenParams,
  LinearConnectionResolverResult,
  LinearSecretsStore,
  LinearTokenStore,
  StoreLinearTokensParams,
} from '#core/tokens.js';
export {
  createLinearTokenStore,
  linearSecretsNamespace,
} from '#core/tokens.js';
export type {HandleLinearWebhookOutcome, HandleLinearWebhookParams} from '#core/webhook.js';
export {handleLinearWebhook} from '#core/webhook.js';
export type {
  CreateLinearWebhookProcessorOptions,
  LinearWebhookProcessor,
} from '#core/webhook-processor.js';
export {createLinearWebhookProcessor} from '#core/webhook-processor.js';
export type {
  LinearInstallation,
  LinearInstallationStatus,
  UpdateLinearInstallationTokenExpiryParams,
  UpsertLinearInstallationParams,
} from '#db/installations.js';
export {
  deleteLinearInstallationByConnectionId,
  getLinearInstallationByConnectionId,
  getLinearInstallationByOrganizationId,
  markLinearInstallationRevoked,
  updateLinearInstallationTokenExpiry,
  upsertLinearInstallation,
  withLinearRefreshLock,
} from '#db/installations.js';
export {
  type CreateLinearE2eRoutesOptions,
  createLinearE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export {closeDb, config, db, migrationsPath};

export interface CreateLinearIntegrationProviderOptions {
  linear?: LinearApiClient | undefined;
  agentTools?:
    | {
        tokenStore: Pick<LinearTokenStore, 'getAccessToken'>;
        endpoint?: string | URL | undefined;
        callTimeoutMs?: number | undefined;
      }
    | undefined;
  getLinearInstallationByConnectionId?: typeof getLinearInstallationByConnectionId | undefined;
  cleanup?:
    | {
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
  routes?:
    | (Omit<CreateLinearIntegrationRoutesOptions, 'linear' | 'connectionCapabilities'> &
        Partial<CreateLinearWebhookRoutesOptions>)
    | undefined;
}

export function createLinearIntegrationProvider(
  options: CreateLinearIntegrationProviderOptions = {},
) {
  const linear = options.linear ?? createLinearApiClient();
  const getInstallationByConnectionId =
    options.getLinearInstallationByConnectionId ?? getLinearInstallationByConnectionId;
  const adapters = options.agentTools
    ? {
        agent_tools: new LinearAgentToolsProvider(options.agentTools),
      }
    : {};
  const webhookProcessor =
    options.routes && hasLinearWebhookRoutesOptions(options.routes)
      ? createLinearWebhookProcessor(options.routes)
      : undefined;

  const routes = options.routes
    ? [
        createLinearIntegrationRoutes({
          linear,
          connectionCapabilities: adapters.agent_tools ? ['agent_tools'] : [],
          ...options.routes,
        }),
      ]
    : [];
  if (options.routes && hasLinearWebhookRoutesOptions(options.routes) && webhookProcessor) {
    routes.push(createLinearWebhookRoutes({...options.routes, processor: webhookProcessor}));
  }

  return {
    provider: LINEAR_PROVIDER,
    displayName: 'Linear',
    eventCatalog: linearEventCatalog,
    adapters,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation?.organizationUrlKey) return undefined;
      return `https://linear.app/${encodeURIComponent(installation.organizationUrlKey)}/settings/applications/${encodeURIComponent(config.LINEAR_OAUTH_CLIENT_ID)}`;
    },
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['linear'] as const, processor: webhookProcessor}]
      : undefined,
  };
}

function hasLinearWebhookRoutesOptions(
  routes: Partial<CreateLinearWebhookRoutesOptions>,
): routes is CreateLinearWebhookRoutesOptions {
  return (
    routes.coreDb !== undefined &&
    routes.publishIntegrationEventReceived !== undefined &&
    routes.recordDeliveryOnly !== undefined &&
    routes.getIntegrationConnectionById !== undefined
  );
}
