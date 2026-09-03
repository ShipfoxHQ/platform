import {
  createE2eGithubConnectionBodySchema,
  createE2eGithubConnectionResponseSchema,
} from '@shipfox/api-integration-github-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {ConnectGithubInstallationInput} from '#core/install.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eGithubConnectionRouteOptions {
  getExistingGithubConnection: (input: {
    installationId: string;
  }) => Promise<IntegrationConnection<'github'> | undefined>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eGithubConnectionRoute(options: CreateE2eGithubConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/github-connections',
    description: 'Create a synthetic GitHub connection for E2E tests.',
    schema: {
      body: createE2eGithubConnectionBodySchema,
      response: {201: createE2eGithubConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const installationId = String(body.installation_id);
      const existing = await options.getExistingGithubConnection({installationId});
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'GitHub installation is already connected to another workspace',
          'github-connection-workspace-mismatch',
          {status: 409},
        );
      }

      const connection =
        existing ??
        (await options.connectGithubInstallation({
          workspaceId: body.workspace_id,
          installationId,
          displayName: body.display_name,
          installerUserId: body.installer_user_id,
          ...(body.lifecycle_status === undefined ? {} : {lifecycleStatus: body.lifecycle_status}),
          installation: {
            installationId,
            accountLogin: body.account_login,
            accountType: 'Organization',
            repositorySelection: 'all',
            suspendedAt: null,
            deletedAt: null,
            latestEvent: {
              id: body.installation_id,
              account: {login: body.account_login, type: 'Organization'},
              repository_selection: 'all',
            },
            installerUserId: body.installer_user_id,
          },
        }));

      reply.code(201);
      return toIntegrationConnectionDto(connection, {
        capabilities: options.connectionCapabilities,
      });
    },
  });
}
