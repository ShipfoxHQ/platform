import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  triggerEventFacetsQuerySchema,
  triggerEventFacetsResponseSchema,
} from '@shipfox/api-triggers-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {listTriggerEventFacets} from '#db/index.js';

export const listTriggerEventFacetsRoute = defineRoute({
  method: 'GET',
  path: '/facets',
  description: 'Distinct source, event, and origin filter values (with counts) for a workspace.',
  schema: {
    querystring: triggerEventFacetsQuerySchema,
    response: {
      200: triggerEventFacetsResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspace_id: workspaceId} = request.query;

    requireWorkspaceAccess({request, workspaceId});

    return await listTriggerEventFacets({workspaceId});
  },
});
