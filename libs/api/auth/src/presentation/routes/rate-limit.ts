import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {describeRateLimitError} from '@shipfox/node-rate-limit';
import {
  type AuthRateLimitAction,
  type AuthRateLimitPolicy,
  type AuthRateLimitScope,
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
  'bootstrap-state': {
    ip: {limit: 60, windowSeconds: 5 * 60},
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
    const presentation = describeRateLimitError({
      error,
      route: routeName(params.request),
      unavailableCode: 'auth-rate-limit-unavailable',
      unavailableMessage: 'Authentication rate limiter unavailable',
    });
    if (!presentation) throw error;

    if (presentation.status === 429) {
      params.request.log.warn(
        {...presentation.data, retryAfterSeconds: presentation.retryAfterSeconds},
        'Auth rate limit blocked request',
      );
      params.reply.header('Retry-After', String(presentation.retryAfterSeconds));
    } else {
      params.request.log.error({...presentation.data, err: error}, 'Auth rate limiter unavailable');
    }

    throw new ClientError(presentation.message, presentation.code, {
      status: presentation.status,
      ...(presentation.details ? {details: presentation.details} : {}),
      data: presentation.data,
      cause: error,
    });
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
