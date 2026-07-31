import {AUTH_USER, getUserContext} from '@shipfox/api-auth-context';
import {
  workspaceSlugAvailabilityQuerySchema,
  workspaceSlugAvailabilityResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {checkWorkspaceSlugAvailability} from '#core/index.js';
import {createWorkspaceSlugAvailabilityRateLimitPreHandler} from '../rate-limit.js';

export const workspaceSlugAvailabilityRoute = defineRoute({
  method: 'GET',
  path: '/slug-availability',
  description: 'Check whether a workspace slug is available.',
  auth: AUTH_USER,
  schema: {
    querystring: workspaceSlugAvailabilityQuerySchema,
    response: {
      200: workspaceSlugAvailabilityResponseSchema,
    },
  },
  preHandler: createWorkspaceSlugAvailabilityRateLimitPreHandler(),
  handler: async (request) => {
    const client = getUserContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    return {available: await checkWorkspaceSlugAvailability(request.query.slug)};
  },
});
