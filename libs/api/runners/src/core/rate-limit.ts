import {rateLimitIdentifierKey} from '@shipfox/node-auth-root-key';
import {
  checkRateLimit,
  hashRateLimitIdentifier,
  RateLimitExceededError,
  type RateLimitOutcome,
  type RateLimitPolicy,
  RateLimitUnavailableError,
} from '@shipfox/node-rate-limit';
import {config} from '#config.js';
import {consumeRunnersRateLimit, pruneExpiredRunnersRateLimits} from '#db/rate-limits.js';
import {recordRunnersRateLimitCheck, recordRunnersRateLimitPruneFailure} from '#metrics/index.js';

export type RunnersRateLimitAction = 'provisioner-mint';
export type RunnersRateLimitScope = 'provisioner';
export type RunnersRateLimitOutcome = RateLimitOutcome;
export type RunnersRateLimitPolicy = RateLimitPolicy;

export interface CheckRunnersRateLimitParams extends RunnersRateLimitPolicy {
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  identifier: string;
  now?: Date | undefined;
  timeoutMs?: number | undefined;
}

export class RunnersRateLimitExceededError extends RateLimitExceededError<
  RunnersRateLimitAction,
  RunnersRateLimitScope
> {
  constructor(params: {
    action: RunnersRateLimitAction;
    scope: RunnersRateLimitScope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super(params);
    this.name = 'RunnersRateLimitExceededError';
  }
}

export class RunnersRateLimitUnavailableError extends RateLimitUnavailableError<
  RunnersRateLimitAction,
  RunnersRateLimitScope
> {
  constructor(params: {
    action: RunnersRateLimitAction;
    scope: RunnersRateLimitScope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super(params);
    this.name = 'RunnersRateLimitUnavailableError';
  }
}

const IDENTIFIER_HASH_DOMAIN = 'shipfox.runners.rate-limit.identifier.v1';

export function hashRunnersRateLimitIdentifier(params: {
  action: RunnersRateLimitAction;
  scope: RunnersRateLimitScope;
  identifier: string;
}): string {
  return hashRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
    secret: effectiveIdentifierSecret(),
    domain: IDENTIFIER_HASH_DOMAIN,
  });
}

export async function checkRunnersRateLimit(params: CheckRunnersRateLimitParams): Promise<void> {
  try {
    await checkRateLimit({
      action: params.action,
      scope: params.scope,
      identifier: params.identifier,
      limit: params.limit,
      windowSeconds: params.windowSeconds,
      identifierSecret: effectiveIdentifierSecret(),
      identifierHashDomain: IDENTIFIER_HASH_DOMAIN,
      consume: consumeRunnersRateLimit,
      prune: pruneExpiredRunnersRateLimits,
      onCheck: recordRunnersRateLimitCheck,
      onPruneFailure: recordRunnersRateLimitPruneFailure,
      now: params.now,
      timeoutMs: params.timeoutMs ?? config.RUNNERS_RATE_LIMIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new RunnersRateLimitExceededError({
        action: error.action,
        scope: error.scope,
        retryAfterSeconds: error.retryAfterSeconds,
        identifierHmacPrefix: error.identifierHmacPrefix,
      });
    }
    if (error instanceof RateLimitUnavailableError) {
      throw new RunnersRateLimitUnavailableError({
        action: error.action,
        scope: error.scope,
        identifierHmacPrefix: error.identifierHmacPrefix,
        cause: error.cause,
      });
    }
    throw error;
  }
}

function effectiveIdentifierSecret(): Uint8Array {
  return rateLimitIdentifierKey();
}
