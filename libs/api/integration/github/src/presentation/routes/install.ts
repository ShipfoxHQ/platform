import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createGithubInstallBodySchema,
  createGithubInstallResponseSchema,
  githubCallbackQuerySchema,
  githubCallbackResponseSchema,
} from '@shipfox/api-integration-github-dto';
import {requireMembership, requireWorkspaceMembership} from '@shipfox/api-workspaces';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {GithubApiClient} from '#api/client.js';
import {config} from '#config.js';
import {type ConnectGithubInstallationInput, handleGithubCallback} from '#core/install.js';
import {signGithubInstallState} from '#core/state.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {githubRouteErrorHandler} from './errors.js';

export interface CreateGithubIntegrationRoutesOptions {
  github: GithubApiClient;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
}

export function createGithubIntegrationRoutes({
  github,
  connectGithubInstallation,
}: CreateGithubIntegrationRoutesOptions): RouteGroup {
  const createInstallRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a GitHub App installation URL for a workspace.',
    schema: {
      body: createGithubInstallBodySchema,
      response: {
        200: createGithubInstallResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);

      await requireMembership({request, workspaceId});
      const state = signGithubInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL(
        `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
      );
      installUrl.searchParams.set('state', state);

      return {install_url: installUrl.toString()};
    },
  });

  const callbackRoute = defineRoute({
    method: 'GET',
    path: '/callback',
    description: 'Handle the GitHub App installation callback.',
    schema: {
      querystring: githubCallbackQuerySchema,
      response: {
        200: githubCallbackResponseSchema,
      },
    },
    errorHandler: githubRouteErrorHandler,
    handler: async (request) => {
      const connection = await handleGithubCallback({
        github,
        code: request.query.code,
        installationId: request.query.installation_id,
        state: request.query.state,
        requireWorkspaceMembership,
        connectGithubInstallation,
      });

      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/github',
    routes: [createInstallRoute, callbackRoute],
  };
}
