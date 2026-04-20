import {getApiKeyContext} from '@shipfox/api-auth-context';
import {definitionResponseSchema} from '@shipfox/api-definitions-dto';
import {ProjectNotFoundError, requireProjectForWorkspace} from '@shipfox/api-projects';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getDefinitionById} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';

export const getDefinitionRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a definition by ID',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: definitionResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError('Definition not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {id} = request.params;
    const definition = await getDefinitionById(id);

    if (!definition) {
      throw new ClientError('Definition not found', 'not-found', {status: 404});
    }
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }
    await requireProjectForWorkspace({
      projectId: definition.projectId,
      workspaceId: apiKeyContext.workspaceId,
    });

    return toDefinitionDto(definition);
  },
});
