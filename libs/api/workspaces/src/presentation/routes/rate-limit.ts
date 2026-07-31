import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {enforceRateLimit as enforceSharedRateLimit} from '@shipfox/node-rate-limit';
import {
  checkWorkspacesRateLimit,
  WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
} from '#core/rate-limit.js';

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

export function createWorkspaceSlugAvailabilityRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await enforceSharedRateLimit({
      request,
      reply,
      check: () =>
        checkWorkspacesRateLimit({
          action: 'slug-availability',
          scope: 'ip',
          identifier: request.ip,
          ...WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
        }),
      route: routeName(request),
      unavailableCode: 'workspace-rate-limit-unavailable',
      unavailableMessage: 'Workspace rate limiter unavailable',
      setRetryAfter: (reply, retryAfterSeconds) => {
        reply.header('Retry-After', String(retryAfterSeconds));
      },
      logWarn: (request, context) => {
        request.log.warn(context, 'Workspace rate limit blocked request');
      },
      logError: (request, context) => {
        request.log.error(context, 'Workspace rate limiter unavailable');
      },
      createClientError: (presentation, cause) =>
        new ClientError(presentation.message, presentation.code, {
          status: presentation.status,
          ...(presentation.details ? {details: presentation.details} : {}),
          data: presentation.data,
          cause,
        }),
    });
  };
}
