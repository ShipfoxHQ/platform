import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {
  type AuthRateLimitAction,
  AuthRateLimitExceededError,
  type AuthRateLimitPolicy,
  type AuthRateLimitScope,
  AuthRateLimitUnavailableError,
  checkAuthRateLimit,
} from '#core/rate-limit.js';

const policies: Record<
  AuthRateLimitAction,
  Partial<Record<AuthRateLimitScope, AuthRateLimitPolicy>>
> = {
  login: {
    ip: {limit: 60, windowSeconds: 5 * 60},
    email: {limit: 10, windowSeconds: 15 * 60},
  },
  'email-send': {
    ip: {limit: 30, windowSeconds: 60 * 60},
    email: {limit: 3, windowSeconds: 60 * 60},
  },
  bootstrap: {
    ip: {limit: 5, windowSeconds: 15 * 60},
  },
  lookup: {
    ip: {limit: 60, windowSeconds: 5 * 60},
  },
};

interface EmailBody {
  email: string;
}

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

async function enforceRateLimit(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  identifier: string;
}): Promise<void> {
  const policy = policies[params.action][params.scope];
  if (!policy) return;

  try {
    await checkAuthRateLimit({
      action: params.action,
      scope: params.scope,
      identifier: params.identifier,
      ...policy,
    });
  } catch (error) {
    if (error instanceof AuthRateLimitExceededError) {
      params.request.log.warn(
        {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          retryAfterSeconds: error.retryAfterSeconds,
          identifierHmacPrefix: error.identifierHmacPrefix,
        },
        'Auth rate limit blocked request',
      );
      params.reply.header('Retry-After', String(error.retryAfterSeconds));
      throw new ClientError('Rate limit exceeded', 'rate-limited', {
        status: 429,
        details: {retry_after_seconds: error.retryAfterSeconds},
        data: {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          identifierHmacPrefix: error.identifierHmacPrefix,
        },
        cause: error,
      });
    }

    if (error instanceof AuthRateLimitUnavailableError) {
      params.request.log.error(
        {
          action: error.action,
          scope: error.scope,
          route: routeName(params.request),
          identifierHmacPrefix: error.identifierHmacPrefix,
          err: error,
        },
        'Auth rate limiter unavailable',
      );
      throw new ClientError(
        'Authentication rate limiter unavailable',
        'auth-rate-limit-unavailable',
        {
          status: 503,
          data: {
            action: error.action,
            scope: error.scope,
            route: routeName(params.request),
            identifierHmacPrefix: error.identifierHmacPrefix,
          },
          cause: error,
        },
      );
    }

    throw error;
  }
}

export function createAuthRateLimitPreHandler(action: AuthRateLimitAction) {
  return async (request: FastifyRequest<{Body: EmailBody}>, reply: FastifyReply): Promise<void> => {
    await enforceRateLimit({
      request,
      reply,
      action,
      scope: 'ip',
      identifier: request.ip,
    });

    await enforceRateLimit({
      request,
      reply,
      action,
      scope: 'email',
      identifier: request.body.email,
    });
  };
}

export function createAuthIpRateLimitPreHandler(action: AuthRateLimitAction) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await enforceRateLimit({
      request,
      reply,
      action,
      scope: 'ip',
      identifier: request.ip,
    });
  };
}
