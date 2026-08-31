import {SLACK_PROVIDER, slackEventCatalog} from '@shipfox/api-integration-slack-dto';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createSlackApiClient, type SlackApiClient} from '#api/client.js';
import {config} from '#config.js';
import {SlackAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {SlackTokenStore} from '#core/tokens.js';
import {createSlackWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {getSlackInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateSlackIntegrationRoutesOptions,
  createSlackIntegrationRoutes,
} from '#presentation/routes/install.js';
import {
  type CreateSlackWebhookRoutesOptions,
  createSlackWebhookRoutes,
} from '#presentation/routes/webhooks.js';

type SlackInstallationRouteOptions = Omit<
  CreateSlackIntegrationRoutesOptions,
  'slack' | 'connectionCapabilities'
>;
type SlackRouteOptions = Partial<SlackInstallationRouteOptions> &
  Partial<CreateSlackWebhookRoutesOptions>;

export type {SlackProvider} from '@shipfox/api-integration-slack-dto';
export type {SlackApiClient, SlackAuthorization, SlackWebApiResponse} from '#api/client.js';
export {createSlackApiClient} from '#api/client.js';
export type {
  SlackAgentToolCatalogEntry,
  SlackAgentToolId,
  SlackAgentToolRequiredScope,
} from '#core/agent-tools.js';
export {slackAgentToolCatalog, slackAgentToolSelectionCatalog} from '#core/agent-tools.js';
export type {
  SlackAgentToolsProviderOptions,
  SlackToolCallResult,
} from '#core/agent-tools-provider.js';
export {SlackAgentToolsProvider} from '#core/agent-tools-provider.js';
export {
  type DisconnectSlackInstallationParams,
  disconnectSlackInstallation,
} from '#core/disconnect.js';
export {
  SlackAccessTokenUnavailableError,
  type SlackAccessTokenUnavailableReason,
  SlackAuthorizationScopeMismatchError,
  SlackBotTokenMissingError,
  SlackConnectionAlreadyLinkedError,
  SlackConnectionNotFoundError,
  SlackEnterpriseInstallUnsupportedError,
  SlackInstallationAlreadyLinkedError,
  SlackInstallStateActorMismatchError,
  SlackInstallStateError,
  SlackIntegrationProviderError,
  SlackOAuthCallbackError,
} from '#core/errors.js';
export type {ConnectSlackInstallationInput, HandleSlackCallbackParams} from '#core/install.js';
export {handleSlackCallback, handleSlackOAuthCallbackError} from '#core/install.js';
export {
  assertSlackAuthorizationScopes,
  formatSlackBotScopes,
  SLACK_BOT_SCOPES,
} from '#core/scopes.js';
export type {VerifySlackSignatureParams} from '#core/signature.js';
export {isSlackTimestampWithinReplayWindow, verifySlackSignature} from '#core/signature.js';
export type {SlackInstallStateClaims} from '#core/state.js';
export {signSlackInstallState, verifySlackInstallState} from '#core/state.js';
export type {
  CreateSlackTokenStoreParams,
  GetSlackAccessTokenParams,
  SlackConnectionResolverResult,
  SlackSecretsStore,
  SlackTokenStore,
  StoreSlackTokensParams,
} from '#core/tokens.js';
export {createSlackTokenStore, slackSecretsNamespace} from '#core/tokens.js';
export type {
  HandleSlackCommandParams,
  HandleSlackEventParams,
  SlackWebhookOutcome,
} from '#core/webhook.js';
export {handleSlackCommand, handleSlackEvent, isSelfAuthoredSlackEvent} from '#core/webhook.js';
export type {
  CreateSlackWebhookProcessorOptions,
  SlackWebhookProcessingResult,
  SlackWebhookProcessor,
} from '#core/webhook-processor.js';
export {createSlackWebhookProcessor} from '#core/webhook-processor.js';
export type {
  SlackInstallation,
  SlackInstallationStatus,
  UpsertSlackInstallationParams,
} from '#db/installations.js';
export {
  deleteSlackInstallationByConnectionId,
  getSlackInstallationByConnectionId,
  getSlackInstallationByTeamId,
  markSlackInstallationRevoked,
  upsertSlackInstallation,
} from '#db/installations.js';
export {
  type CreateSlackE2eRoutesOptions,
  createSlackE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export {
  type CreateSlackWebhookRoutesOptions,
  createSlackWebhookRoutes,
  SLACK_WEBHOOK_BODY_LIMIT,
  SLASH_COMMAND_ACK,
} from '#presentation/routes/webhooks.js';
export {closeDb, config, db, migrationsPath};

export interface CreateSlackIntegrationProviderOptions {
  slack?: SlackApiClient | undefined;
  agentTools?: {tokenStore: Pick<SlackTokenStore, 'getAccessToken'>} | undefined;
  getSlackInstallationByConnectionId?: typeof getSlackInstallationByConnectionId | undefined;
  cleanup?:
    | {
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
  routes?: SlackRouteOptions | undefined;
}

export function createSlackIntegrationProvider(
  options: CreateSlackIntegrationProviderOptions = {},
) {
  const slack = options.slack ?? createSlackApiClient();
  const getInstallationByConnectionId =
    options.getSlackInstallationByConnectionId ?? getSlackInstallationByConnectionId;
  const adapters = options.agentTools
    ? {
        agent_tools: new SlackAgentToolsProvider({
          slack,
          tokenStore: options.agentTools.tokenStore,
        }),
      }
    : {};
  assertValidSlackRouteOptions(options.routes);
  const routes: RouteGroup[] = [];
  const webhookProcessor =
    options.routes && hasSlackWebhookRoutesOptions(options.routes)
      ? createSlackWebhookProcessor(options.routes)
      : undefined;
  if (options.routes && hasSlackInstallationRoutesOptions(options.routes)) {
    const {
      tokenStore,
      getExistingSlackConnection,
      connectSlackInstallation,
      disconnectSlackInstallation,
      requireActiveWorkspaceMembership,
    } = options.routes;
    routes.push(
      createSlackIntegrationRoutes({
        slack,
        connectionCapabilities: adapters.agent_tools ? ['agent_tools'] : [],
        tokenStore,
        getExistingSlackConnection,
        connectSlackInstallation,
        disconnectSlackInstallation,
        ...(requireActiveWorkspaceMembership ? {requireActiveWorkspaceMembership} : {}),
      }),
    );
  }
  if (options.routes && hasSlackWebhookRoutesOptions(options.routes) && webhookProcessor) {
    routes.push(...createSlackWebhookRoutes({...options.routes, processor: webhookProcessor}));
  }

  return {
    provider: SLACK_PROVIDER,
    displayName: 'Slack',
    eventCatalog: slackEventCatalog,
    adapters,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      return `https://app.slack.com/client/${encodeURIComponent(installation.teamId)}`;
    },
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['slack.event', 'slack.command'] as const, processor: webhookProcessor}]
      : undefined,
  };
}

function assertValidSlackRouteOptions(routes: SlackRouteOptions | undefined): void {
  if (!routes) return;
  if (hasSlackInstallationRoutesOptions(routes) || hasSlackWebhookRoutesOptions(routes)) return;
  throw new Error('Slack webhook routes require every core persistence dependency');
}

function hasSlackInstallationRoutesOptions(
  routes: SlackRouteOptions,
): routes is SlackInstallationRouteOptions {
  return (
    routes.tokenStore !== undefined &&
    routes.getExistingSlackConnection !== undefined &&
    routes.connectSlackInstallation !== undefined &&
    routes.disconnectSlackInstallation !== undefined
  );
}

function hasSlackWebhookRoutesOptions(
  routes: SlackRouteOptions,
): routes is CreateSlackWebhookRoutesOptions {
  return (
    routes.coreDb !== undefined &&
    routes.claimWebhookDelivery !== undefined &&
    routes.publishIntegrationEventReceived !== undefined &&
    routes.recordDeliveryOnly !== undefined &&
    routes.getIntegrationConnectionById !== undefined
  );
}
