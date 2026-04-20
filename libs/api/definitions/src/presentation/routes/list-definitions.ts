import {getApiKeyContext} from '@shipfox/api-auth-context';
import {definitionListResponseSchema} from '@shipfox/api-definitions-dto';
import {ProjectNotFoundError, requireProjectForWorkspace} from '@shipfox/api-projects';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listDefinitionsByProject} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';

export const listDefinitionsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List all definitions for a project',
  schema: {
    querystring: z.object({
      project_id: z.string().uuid(),
    }),
    response: {
      200: definitionListResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError(error.message, 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {project_id: projectId} = request.query;
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }
    await requireProjectForWorkspace({projectId, workspaceId: apiKeyContext.workspaceId});
    const definitions = await listDefinitionsByProject(projectId);

    return {
      definitions: definitions.map(toDefinitionDto),
    };
  },
});
