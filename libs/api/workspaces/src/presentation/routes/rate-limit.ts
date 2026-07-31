import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {describeRateLimitError} from '@shipfox/node-rate-limit';
import {
  checkWorkspacesRateLimit,
  WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
} from '#core/rate-limit.js';

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

export function createWorkspaceSlugAvailabilityRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      await checkWorkspacesRateLimit({
        action: 'slug-availability',
        scope: 'ip',
        identifier: request.ip,
        ...WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
      });
    } catch (error) {
      const presentation = describeRateLimitError({
        error,
        route: routeName(request),
        unavailableCode: 'workspace-rate-limit-unavailable',
        unavailableMessage: 'Workspace rate limiter unavailable',
      });
      if (!presentation) throw error;

      if (presentation.status === 429) {
        request.log.warn(
          {...presentation.data, retryAfterSeconds: presentation.retryAfterSeconds},
          'Workspace rate limit blocked request',
        );
        reply.header('Retry-After', String(presentation.retryAfterSeconds));
      } else {
        request.log.error({...presentation.data, err: error}, 'Workspace rate limiter unavailable');
      }

      throw new ClientError(presentation.message, presentation.code, {
        status: presentation.status,
        ...(presentation.details ? {details: presentation.details} : {}),
        data: presentation.data,
        cause: error,
      });
    }
  };
}
