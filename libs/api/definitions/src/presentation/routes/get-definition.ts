import {definitionResponseSchema} from '@shipfox/api-definitions-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  getDefinitionById,
  getDefinitionByWorkflowId,
  getWorkflowLineageById,
} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export function buildGetDefinitionRoute(projects: ProjectsModuleClient) {
  return defineRoute({
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
    handler: async (request) => {
      const {id} = request.params;
      const definition = await getDefinitionById(id);

      if (definition) {
        await requireProjectAccess(request, definition.projectId, projects);
        return toDefinitionDto(definition);
      }

      const lineage = await getWorkflowLineageById(id);
      if (!lineage) {
        throw new ClientError('Definition not found', 'not-found', {status: 404});
      }

      const project = await requireProjectAccess(request, lineage.projectId, projects);
      const syncedDefinition = project.sourceDefaultBranch
        ? await getDefinitionByWorkflowId({workflowId: id, ref: project.sourceDefaultBranch})
        : undefined;
      if (!syncedDefinition) {
        throw new ClientError('Definition not found', 'not-found', {status: 404});
      }

      return toDefinitionDto(syncedDefinition);
    },
  });
}
