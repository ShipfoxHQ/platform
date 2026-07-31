import {rateLimitIdentifierKey} from '@shipfox/node-auth-root-key';
import {
  checkRateLimit,
  hashRateLimitIdentifier,
  RateLimitExceededError,
  type RateLimitOutcome,
  type RateLimitPolicy,
  RateLimitUnavailableError,
} from '@shipfox/node-rate-limit';
import {consumeWorkspacesRateLimit, pruneExpiredWorkspacesRateLimits} from '#db/rate-limits.js';
import {
  recordWorkspaceRateLimitCheck,
  recordWorkspaceRateLimitPruneFailure,
} from '#metrics/instance.js';

export type WorkspacesRateLimitAction = 'slug-availability';
export type WorkspacesRateLimitScope = 'ip';
export type WorkspacesRateLimitOutcome = RateLimitOutcome;
export type WorkspacesRateLimitPolicy = RateLimitPolicy;

export interface CheckWorkspacesRateLimitParams extends WorkspacesRateLimitPolicy {
  action: WorkspacesRateLimitAction;
  scope: WorkspacesRateLimitScope;
  identifier: string;
  now?: Date | undefined;
  timeoutMs?: number | undefined;
}

export class WorkspacesRateLimitExceededError extends RateLimitExceededError<
  WorkspacesRateLimitAction,
  WorkspacesRateLimitScope
> {
  constructor(params: {
    action: WorkspacesRateLimitAction;
    scope: WorkspacesRateLimitScope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super(params);
    this.name = 'WorkspacesRateLimitExceededError';
  }
}

export class WorkspacesRateLimitUnavailableError extends RateLimitUnavailableError<
  WorkspacesRateLimitAction,
  WorkspacesRateLimitScope
> {
  constructor(params: {
    action: WorkspacesRateLimitAction;
    scope: WorkspacesRateLimitScope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super(params);
    this.name = 'WorkspacesRateLimitUnavailableError';
  }
}

export const WORKSPACE_SLUG_AVAILABILITY_RATE_LIMIT = {
  limit: 60,
  windowSeconds: 5 * 60,
} as const;

const RATE_LIMIT_TIMEOUT_MS = 250;
const IDENTIFIER_HASH_DOMAIN = 'shipfox.workspaces.rate-limit.identifier.v1';

export function hashWorkspacesRateLimitIdentifier(params: {
  action: WorkspacesRateLimitAction;
  scope: WorkspacesRateLimitScope;
  identifier: string;
}): string {
  return hashRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
    secret: rateLimitIdentifierKey(),
    domain: IDENTIFIER_HASH_DOMAIN,
  });
}

export async function checkWorkspacesRateLimit(
  params: CheckWorkspacesRateLimitParams,
): Promise<void> {
  try {
    await checkRateLimit({
      action: params.action,
      scope: params.scope,
      identifier: params.identifier,
      limit: params.limit,
      windowSeconds: params.windowSeconds,
      identifierSecret: rateLimitIdentifierKey(),
      identifierHashDomain: IDENTIFIER_HASH_DOMAIN,
      consume: consumeWorkspacesRateLimit,
      prune: pruneExpiredWorkspacesRateLimits,
      onCheck: recordWorkspaceRateLimitCheck,
      onPruneFailure: recordWorkspaceRateLimitPruneFailure,
      now: params.now,
      timeoutMs: params.timeoutMs ?? RATE_LIMIT_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RateLimitExceededError) {
      throw new WorkspacesRateLimitExceededError({
        action: error.action,
        scope: error.scope,
        retryAfterSeconds: error.retryAfterSeconds,
        identifierHmacPrefix: error.identifierHmacPrefix,
      });
    }
    if (error instanceof RateLimitUnavailableError) {
      throw new WorkspacesRateLimitUnavailableError({
        action: error.action,
        scope: error.scope,
        identifierHmacPrefix: error.identifierHmacPrefix,
        cause: error.cause,
      });
    }
    throw error;
  }
}
