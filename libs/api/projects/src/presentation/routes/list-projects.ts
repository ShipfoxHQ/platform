import {AUTH_USER} from '@shipfox/api-auth-context';
import {listProjectsQuerySchema, listProjectsResponseSchema} from '@shipfox/api-projects-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listProjects} from '#db/index.js';
import {toProjectDto} from '#presentation/dto/index.js';
import {decodeProjectCursor, encodeProjectCursor} from './cursor.js';

export const listProjectsRoute = defineRoute({
  method: 'GET',
  path: '/',
  auth: AUTH_USER,
  description: 'List projects in a workspace.',
  schema: {
    querystring: listProjectsQuerySchema,
    response: {
      200: listProjectsResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspace_id: workspaceId, limit, cursor} = request.query;
    const decodedCursor = decodeProjectCursor(cursor);
    if (cursor && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    await requireMembership({request, workspaceId});
    const result = await listProjects({workspaceId, limit, cursor: decodedCursor});

    return {
      projects: result.projects.map(toProjectDto),
      next_cursor: result.nextCursor ? encodeProjectCursor(result.nextCursor) : null,
    };
  },
});
