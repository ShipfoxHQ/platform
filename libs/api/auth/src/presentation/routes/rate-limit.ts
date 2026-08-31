import {getUserContext} from '@shipfox/api-auth-context';
import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {enforceRateLimit as enforceSharedRateLimit} from '@shipfox/node-rate-limit';
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
  directory: {
    ip: {limit: 60, windowSeconds: 5 * 60},
    actor: {limit: 60, windowSeconds: 5 * 60},
  },
  impersonate: {
    // Bounds mint and probing attempts: the IP bucket bounds aggregate source
    // traffic, and the actor bucket is a per-actor cap that prevents an actor
    // from evading the bound by rotating IPs (every request still consumes the
    // IP bucket first, so a shared NAT cannot exhaust it faster by pooling
    // actors). Ladder denials by an identifiable actor role are audited as
    // `failed` events.
    ip: {limit: 20, windowSeconds: 15 * 60},
    actor: {limit: 20, windowSeconds: 15 * 60},
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

  await enforceSharedRateLimit({
    request: params.request,
    reply: params.reply,
    check: () =>
      checkAuthRateLimit({
        action: params.action,
        scope: params.scope,
        identifier: params.identifier,
        ...policy,
      }),
    route: routeName(params.request),
    unavailableCode: 'auth-rate-limit-unavailable',
    unavailableMessage: 'Authentication rate limiter unavailable',
    setRetryAfter: (reply, retryAfterSeconds) => {
      reply.header('Retry-After', String(retryAfterSeconds));
    },
    logWarn: (request, context) => {
      request.log.warn(context, 'Auth rate limit blocked request');
    },
    logError: (request, context) => {
      request.log.error(context, 'Auth rate limiter unavailable');
    },
    createClientError: (presentation, cause) =>
      new ClientError(presentation.message, presentation.code, {
        status: presentation.status,
        ...(presentation.details ? {details: presentation.details} : {}),
        data: presentation.data,
        cause,
      }),
  });
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

/**
 * Rate limits an authenticated route by source IP and by actor. Every request
 * consumes the IP bucket, which bounds aggregate source traffic; the actor
 * bucket is an additional per-actor cap that prevents an actor from evading
 * the bound by rotating IPs. Runs after authentication (auth is an `onRequest`
 * hook), so the user context is set.
 */
export function createAuthActorRateLimitPreHandler(action: AuthRateLimitAction) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await enforceRateLimit({
      request,
      reply,
      action,
      scope: 'ip',
      identifier: request.ip,
    });
    const client = getUserContext(request);
    if (client) {
      await enforceRateLimit({
        request,
        reply,
        action,
        scope: 'actor',
        identifier: client.userId,
      });
    }
  };
}
