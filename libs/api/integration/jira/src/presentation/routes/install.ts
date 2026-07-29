import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  completeJiraSiteSelectionBodySchema,
  createJiraInstallBodySchema,
  createJiraInstallResponseSchema,
  type JiraCallbackQueryDto,
  jiraCallbackQuerySchema,
  jiraCallbackResponseSchema,
} from '@shipfox/api-integration-jira-dto';
import {
  type IntegrationCapability,
  type IntegrationConnection,
  integrationConnectionDtoSchema,
} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {JiraApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type ConnectJiraInstallationInput,
  handleJiraCallback,
  handleJiraOAuthCallbackError,
  handleJiraSiteSelection,
} from '#core/install.js';
import type {JiraPendingSelectionStore} from '#core/pending.js';
import {formatJiraOAuthScopes} from '#core/scopes.js';
import {signJiraInstallState} from '#core/state.js';
import type {JiraTokenStore} from '#core/tokens.js';
import type {JiraInstallationLock} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {jiraRouteErrorHandler} from './errors.js';

export interface CreateJiraIntegrationRoutesOptions {
  jira: JiraApiClient;
  tokenStore: Pick<JiraTokenStore, 'storeTokens'>;
  pendingStore: Pick<JiraPendingSelectionStore, 'save' | 'load' | 'clear'>;
  getExistingJiraConnection(input: {
    cloudId: string;
  }): Promise<IntegrationConnection<'jira'> | undefined>;
  connectJiraInstallation(
    input: ConnectJiraInstallationInput,
  ): Promise<IntegrationConnection<'jira'>>;
  registerJiraWebhook(input: {
    connectionId: string;
    cloudId: string;
    accessToken: string;
    withRegistrationLock?: JiraInstallationLock;
    onRegistrationSuccess: (input: {tx?: unknown}) => Promise<void>;
    onRegistrationFailure: (input: {tx?: unknown}) => Promise<void>;
  }): Promise<void>;
  withJiraInstallationLock?: JiraInstallationLock;
  markConnectionActive(input: {connectionId: string; tx?: unknown}): Promise<void>;
  markConnectionError(input: {connectionId: string; tx?: unknown}): Promise<void>;
  disconnectJiraInstallation(input: {connectionId: string}): Promise<void>;
  connectionCapabilities: IntegrationCapability[];
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
  }) => Promise<unknown>;
}

export function createJiraIntegrationRoutes(
  options: CreateJiraIntegrationRoutesOptions,
): RouteGroup {
  const requireMembership =
    options.requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck;
  const installRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Jira OAuth authorization URL for a workspace.',
    schema: {body: createJiraInstallBodySchema, response: {200: createJiraInstallResponseSchema}},
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      const installUrl = new URL(`${config.JIRA_AUTH_BASE_URL}/authorize`);
      installUrl.searchParams.set('audience', 'api.atlassian.com');
      installUrl.searchParams.set('client_id', config.JIRA_OAUTH_CLIENT_ID);
      installUrl.searchParams.set('scope', formatJiraOAuthScopes());
      installUrl.searchParams.set('redirect_uri', config.JIRA_OAUTH_REDIRECT_URL);
      installUrl.searchParams.set(
        'state',
        signJiraInstallState({workspaceId, userId: actor.userId}),
      );
      installUrl.searchParams.set('response_type', 'code');
      installUrl.searchParams.set('prompt', 'consent');
      return {install_url: installUrl.toString()};
    },
  });
  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the Jira OAuth callback.',
    schema: {querystring: jiraCallbackQuerySchema, response: {200: jiraCallbackResponseSchema}},
    errorHandler: jiraRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const query = request.query;
      if (isJiraOAuthErrorCallback(query))
        return await handleJiraOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership: requireMembership,
        });
      const result = await handleJiraCallback({
        ...options,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership: requireMembership,
      });
      return 'sites' in result
        ? {
            sites: result.sites.map((site) => ({
              cloud_id: site.cloudId,
              name: site.name,
              url: site.url,
              scopes: site.scopes,
            })),
          }
        : toIntegrationConnectionDto(result, {capabilities: options.connectionCapabilities});
    },
  });
  const siteSelectionRoute = defineRoute({
    method: 'POST',
    path: '/callback/site',
    auth: AUTH_USER,
    description: 'Complete Jira OAuth site selection.',
    schema: {
      body: completeJiraSiteSelectionBodySchema,
      response: {200: integrationConnectionDtoSchema},
    },
    errorHandler: jiraRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const connection = await handleJiraSiteSelection({
        ...options,
        cloudId: request.body.cloud_id,
        state: request.body.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership: requireMembership,
      });
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
  return {
    prefix: '/integrations/jira',
    routes: [installRoute, callbackApiRoute, siteSelectionRoute],
  };
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}

function isJiraOAuthErrorCallback(query: JiraCallbackQueryDto): query is JiraCallbackQueryDto & {
  error: string;
  error_description?: string | undefined;
  state: string;
} {
  return 'error' in query && typeof query.error === 'string';
}
