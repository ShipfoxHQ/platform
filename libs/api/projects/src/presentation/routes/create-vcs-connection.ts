import {AUTH_USER} from '@shipfox/api-auth-context';
import {createVcsConnectionBodySchema, vcsConnectionDtoSchema} from '@shipfox/api-projects-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {config} from '#config.js';
import {createVcsConnection} from '#db/index.js';
import {toVcsConnectionDto} from '#presentation/dto/index.js';

export const createVcsConnectionRoute = defineRoute({
  method: 'POST',
  path: '/vcs-connections',
  auth: AUTH_USER,
  description: 'Create a workspace VCS connection.',
  schema: {
    body: createVcsConnectionBodySchema,
    response: {
      201: vcsConnectionDtoSchema,
    },
  },
  handler: async (request, reply) => {
    const {
      workspace_id: workspaceId,
      provider,
      provider_host: providerHost,
      external_connection_id: externalConnectionId,
      display_name: displayName,
    } = request.body;
    if (provider === 'test' && !config.PROJECTS_ENABLE_TEST_VCS_PROVIDER) {
      throw new ClientError('Test VCS provider is disabled.', 'test-provider-disabled', {
        status: 422,
      });
    }
    if (provider !== 'test') {
      throw new ClientError('Provider is not implemented yet', 'provider-not-implemented', {
        status: 422,
      });
    }

    await requireMembership({request, workspaceId});
    const connection = await createVcsConnection({
      workspaceId,
      provider,
      providerHost,
      externalConnectionId,
      displayName,
    });

    reply.status(201);
    return toVcsConnectionDto(connection);
  },
});
