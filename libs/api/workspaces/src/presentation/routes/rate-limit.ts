import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {
  checkWorkspacesRateLimit,
  WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT,
  WorkspacesRateLimitExceededError,
  WorkspacesRateLimitUnavailableError,
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
      if (error instanceof WorkspacesRateLimitExceededError) {
        request.log.warn(
          {
            action: error.action,
            scope: error.scope,
            route: routeName(request),
            retryAfterSeconds: error.retryAfterSeconds,
            identifierHmacPrefix: error.identifierHmacPrefix,
          },
          'Workspace rate limit blocked request',
        );
        reply.header('Retry-After', String(error.retryAfterSeconds));
        throw new ClientError('Rate limit exceeded', 'rate-limited', {
          status: 429,
          details: {retry_after_seconds: error.retryAfterSeconds},
          data: {
            action: error.action,
            scope: error.scope,
            route: routeName(request),
            identifierHmacPrefix: error.identifierHmacPrefix,
          },
          cause: error,
        });
      }

      if (error instanceof WorkspacesRateLimitUnavailableError) {
        request.log.error(
          {
            action: error.action,
            scope: error.scope,
            route: routeName(request),
            identifierHmacPrefix: error.identifierHmacPrefix,
            err: error,
          },
          'Workspace rate limiter unavailable',
        );
        throw new ClientError(
          'Workspace rate limiter unavailable',
          'workspace-rate-limit-unavailable',
          {
            status: 503,
            data: {
              action: error.action,
              scope: error.scope,
              route: routeName(request),
              identifierHmacPrefix: error.identifierHmacPrefix,
            },
            cause: error,
          },
        );
      }

      throw error;
    }
  };
}
