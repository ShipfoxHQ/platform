import {
  definitionListQuerySchema,
  definitionListResponseSchema,
} from '@shipfox/api-definitions-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {toDefinitionDto, toDefinitionSyncSummaryDto} from '#presentation/dto/index.js';
import {listDefinitionsWithSync} from '#presentation/list-definitions.js';
import {requireProjectAccess} from './project-access.js';

export function buildListDefinitionsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description: 'List all definitions for a project',
    schema: {
      querystring: definitionListQuerySchema,
      response: {
        200: definitionListResponseSchema,
      },
    },
    handler: async (request) => {
      const {project_id: projectId, limit, cursor} = request.query;
      const decodedCursor = decodeStringIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const project = await requireProjectAccess(request, projectId, projects);
      const result = await listDefinitionsWithSync({
        projectId,
        limit,
        cursor: decodedCursor,
        sourceConnectionId: project.sourceConnectionId,
        sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      });

      return {
        definitions: result.definitions.map(toDefinitionDto),
        sync: toDefinitionSyncSummaryDto(result.syncState),
        next_cursor: result.nextCursor ? encodeStringIdCursor(result.nextCursor) : null,
      };
    },
  });
}
