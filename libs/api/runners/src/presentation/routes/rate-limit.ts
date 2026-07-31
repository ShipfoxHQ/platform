import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {ClientError, type FastifyReply, type FastifyRequest} from '@shipfox/node-fastify';
import {enforceRateLimit as enforceSharedRateLimit} from '@shipfox/node-rate-limit';
import {config} from '#config.js';
import {checkRunnersRateLimit} from '#core/rate-limit.js';
import {getRunnerContext} from '#presentation/auth/index.js';

function routeName(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split('?')[0] ?? 'unknown';
}

async function enforceRateLimit(params: {
  request: FastifyRequest;
  reply: FastifyReply;
  action: 'provisioner-mint' | 'ephemeral-register';
  scope: 'provisioner' | 'ephemeral-token';
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<void> {
  await enforceSharedRateLimit({
    request: params.request,
    reply: params.reply,
    check: () =>
      checkRunnersRateLimit({
        action: params.action,
        scope: params.scope,
        identifier: params.identifier,
        limit: params.limit,
        windowSeconds: params.windowSeconds,
      }),
    route: routeName(params.request),
    unavailableCode: 'runners-rate-limit-unavailable',
    unavailableMessage: 'Runners rate limiter unavailable',
    setRetryAfter: (reply, retryAfterSeconds) => {
      reply.header('Retry-After', String(retryAfterSeconds));
    },
    logWarn: (request, context) => {
      request.log.warn(context, 'Runners rate limit blocked request');
    },
    logError: (request, context) => {
      request.log.error(context, 'Runners rate limiter unavailable');
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

export function createProvisionerMintRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    await enforceRateLimit({
      request,
      reply,
      action: 'provisioner-mint',
      scope: 'provisioner',
      identifier: provisionerTokenId,
      limit: config.PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS,
      windowSeconds: config.PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS,
    });
  };
}

export function createEphemeralRegisterRateLimitPreHandler() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const runner = getRunnerContext(request);
    if (runner.kind !== 'ephemeral') return;

    await enforceRateLimit({
      request,
      reply,
      action: 'ephemeral-register',
      scope: 'ephemeral-token',
      identifier: runner.ephemeralTokenId,
      limit: config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS,
      windowSeconds: config.EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS,
    });
  };
}
