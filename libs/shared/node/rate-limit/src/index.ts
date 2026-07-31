import {createHmac} from 'node:crypto';

export type RateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';

/**
 * Fixed-window policy for one rate-limited action and scope.
 */
export interface RateLimitPolicy {
  /** Maximum number of allowed calls within one window. */
  limit: number;
  /** Window size in seconds. */
  windowSeconds: number;
}

/**
 * Storage request passed to the caller-owned counter implementation.
 *
 * `consume` must atomically increment the row for
 * `(action, scope, identifierHmac, windowStart)` and return the new count.
 */
export interface ConsumeRateLimitParams<Action extends string, Scope extends string> {
  action: Action;
  scope: Scope;
  /** HMAC of the raw identifier. Store this value, never the raw identifier. */
  identifierHmac: string;
  /** Start time of the fixed window that owns this request. */
  windowStart: Date;
  /** Time when the fixed-window row can be pruned. */
  expiresAt: Date;
  /** Maximum time the storage layer should spend on the consume operation. */
  timeoutMs: number;
}

/**
 * Result returned by the caller-owned counter implementation after one consume.
 */
export interface ConsumeRateLimitResult {
  /** Count after the current request has been consumed. */
  count: number;
  /** Expiry for the consumed window. Used to compute Retry-After on blocks. */
  expiresAt: Date;
}

/**
 * Table-specific operations used by the shared fixed-window persistence
 * mechanics. Each API package keeps its own table and database boundary.
 */
export interface RateLimitPersistenceAdapter<
  Transaction,
  Action extends string = string,
  Scope extends string = string,
> {
  transaction: <Result>(callback: (transaction: Transaction) => Promise<Result>) => Promise<Result>;
  setStatementTimeout: (transaction: Transaction, timeoutMs: number) => Promise<void>;
  consume: (
    transaction: Transaction,
    params: ConsumeRateLimitParams<Action, Scope>,
  ) => Promise<ConsumeRateLimitResult | undefined>;
  prune: (now: Date) => Promise<number>;
}

/**
 * Builds table-owned rate-limit persistence functions with shared transaction,
 * timeout, missing-row, and opportunistic-pruning behavior.
 */
export function createRateLimitPersistence<
  Transaction,
  Action extends string = string,
  Scope extends string = string,
>(adapter: RateLimitPersistenceAdapter<Transaction, Action, Scope>) {
  let nextPruneAt = 0;

  return {
    consume: async (
      params: ConsumeRateLimitParams<Action, Scope>,
    ): Promise<ConsumeRateLimitResult> => {
      return await adapter.transaction(async (transaction) => {
        await adapter.setStatementTimeout(transaction, params.timeoutMs);
        const result = await adapter.consume(transaction, params);
        if (!result) throw new Error('Rate limit upsert returned no rows');
        return result;
      });
    },
    prune: async (
      params: {now?: Date | undefined; minIntervalMs?: number | undefined} = {},
    ): Promise<number | undefined> => {
      const now = params.now ?? new Date();
      const minIntervalMs = params.minIntervalMs ?? 60_000;
      if (minIntervalMs > 0 && now.getTime() < nextPruneAt) return undefined;

      nextPruneAt = now.getTime() + minIntervalMs;
      return await adapter.prune(now);
    },
  };
}

/**
 * Parameters for one rate-limit check.
 *
 * Callers provide product policy, HMAC separation, persistence, and metrics.
 * This shared core only computes the fixed window, hashes the identifier,
 * interprets the returned count, and normalizes errors.
 */
export interface CheckRateLimitParams<Action extends string, Scope extends string>
  extends RateLimitPolicy {
  /** Bounded product action label, such as `login` or `provisioner-mint`. */
  action: Action;
  /** Bounded product scope label, such as `email` or `ephemeral-token`. */
  scope: Scope;
  /** Raw identifier for the subject being limited. It is HMACed before storage. */
  identifier: string;
  /** Secret key used to HMAC the raw identifier. */
  identifierSecret: string | Uint8Array;
  /** Domain separator used to keep hashes distinct across products and versions. */
  identifierHashDomain: string;
  /** Atomically consumes one request from the caller-owned backing store. */
  consume: (params: ConsumeRateLimitParams<Action, Scope>) => Promise<ConsumeRateLimitResult>;
  /** Optional opportunistic cleanup for expired backing-store rows. */
  prune?: ((params: {now: Date}) => Promise<unknown>) | undefined;
  /** Optional metric hook called once with the final check outcome. */
  onCheck?:
    | ((params: {action: Action; scope: Scope; outcome: RateLimitOutcome}) => void)
    | undefined;
  /** Optional metric hook called when background pruning fails. */
  onPruneFailure?: (() => void) | undefined;
  /** Test seam for deterministic fixed-window calculations. Defaults to current time. */
  now?: Date | undefined;
  /** Timeout passed through to `consume`. Defaults to 250 ms. */
  timeoutMs?: number | undefined;
  /** Prefix length exposed on errors for diagnostics without exposing full hashes. */
  identifierHmacPrefixLength?: number | undefined;
}

/**
 * Thrown when the consumed count exceeds the configured policy limit.
 *
 * Presentation layers should usually translate this to a 429 response and set
 * `Retry-After` from `retryAfterSeconds`.
 */
export class RateLimitExceededError<Action extends string, Scope extends string> extends Error {
  readonly action: Action;
  readonly scope: Scope;
  readonly retryAfterSeconds: number;
  readonly identifierHmacPrefix: string;

  constructor(params: {
    action: Action;
    scope: Scope;
    retryAfterSeconds: number;
    identifierHmacPrefix: string;
  }) {
    super('Rate limit exceeded');
    this.name = 'RateLimitExceededError';
    this.action = params.action;
    this.scope = params.scope;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
  }
}

/**
 * Thrown when the backing store cannot complete the check.
 *
 * Callers should fail closed for protected endpoints, usually by translating
 * this to a service-unavailable response.
 */
export class RateLimitUnavailableError<Action extends string, Scope extends string> extends Error {
  readonly action: Action;
  readonly scope: Scope;
  readonly identifierHmacPrefix: string;
  override readonly cause: unknown;

  constructor(params: {
    action: Action;
    scope: Scope;
    identifierHmacPrefix: string;
    cause: unknown;
  }) {
    super('Rate limiter unavailable');
    this.name = 'RateLimitUnavailableError';
    this.action = params.action;
    this.scope = params.scope;
    this.identifierHmacPrefix = params.identifierHmacPrefix;
    this.cause = params.cause;
  }
}

/**
 * Thrown when a caller supplies an invalid fixed-window policy.
 */
export class RateLimitPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitPolicyError';
  }
}

interface RateLimitErrorPresentationBase {
  data: {
    action: string;
    scope: string;
    route: string;
    identifierHmacPrefix: string;
  };
}

export type RateLimitErrorPresentation =
  | (RateLimitErrorPresentationBase & {
      status: 429;
      code: 'rate-limited';
      message: 'Rate limit exceeded';
      retryAfterSeconds: number;
      details: {retry_after_seconds: number};
    })
  | (RateLimitErrorPresentationBase & {
      status: 503;
      code: string;
      message: string;
      details?: never;
      retryAfterSeconds?: never;
    });

export type RateLimitLogContext = RateLimitErrorPresentation['data'] & {
  retryAfterSeconds?: number;
  err?: unknown;
};

/**
 * Normalizes rate-limit failures for HTTP adapters without coupling this
 * shared package to a specific web framework or domain error type.
 */
export function describeRateLimitError(params: {
  error: unknown;
  route: string;
  unavailableCode: string;
  unavailableMessage: string;
}): RateLimitErrorPresentation | undefined {
  const {error} = params;
  if (error instanceof RateLimitExceededError) {
    return {
      status: 429,
      code: 'rate-limited',
      message: 'Rate limit exceeded',
      retryAfterSeconds: error.retryAfterSeconds,
      details: {retry_after_seconds: error.retryAfterSeconds},
      data: {
        action: error.action,
        scope: error.scope,
        route: params.route,
        identifierHmacPrefix: error.identifierHmacPrefix,
      },
    };
  }

  if (error instanceof RateLimitUnavailableError) {
    return {
      status: 503,
      code: params.unavailableCode,
      message: params.unavailableMessage,
      data: {
        action: error.action,
        scope: error.scope,
        route: params.route,
        identifierHmacPrefix: error.identifierHmacPrefix,
      },
    };
  }

  return undefined;
}

/**
 * Runs one rate-limit check and centralizes HTTP adapter error handling.
 * Callers provide only their domain checker, messages, logging, and framework
 * error constructor.
 */
export async function enforceRateLimit<Request, Reply>(params: {
  request: Request;
  reply: Reply;
  check: () => Promise<void>;
  route: string;
  unavailableCode: string;
  unavailableMessage: string;
  setRetryAfter: (reply: Reply, retryAfterSeconds: number) => void;
  logWarn: (request: Request, context: RateLimitLogContext) => void;
  logError: (request: Request, context: RateLimitLogContext) => void;
  createClientError: (presentation: RateLimitErrorPresentation, cause: unknown) => Error;
}): Promise<void> {
  try {
    await params.check();
  } catch (error) {
    const presentation = describeRateLimitError({
      error,
      route: params.route,
      unavailableCode: params.unavailableCode,
      unavailableMessage: params.unavailableMessage,
    });
    if (!presentation) throw error;

    if (presentation.status === 429) {
      params.logWarn(params.request, {
        ...presentation.data,
        retryAfterSeconds: presentation.retryAfterSeconds,
      });
      params.setRetryAfter(params.reply, presentation.retryAfterSeconds);
    } else {
      params.logError(params.request, {...presentation.data, err: error});
    }

    throw params.createClientError(presentation, error);
  }
}

const DEFAULT_TIMEOUT_MS = 250;
const DEFAULT_HASH_PREFIX_LENGTH = 12;

/**
 * Hashes a rate-limit identifier with action, scope, and domain separation.
 *
 * Use the returned value as the storage key. Do not persist or log the raw
 * identifier passed to this function.
 */
export function hashRateLimitIdentifier<Action extends string, Scope extends string>(params: {
  action: Action;
  scope: Scope;
  identifier: string;
  secret: string | Uint8Array;
  domain: string;
}): string {
  return createHmac('sha256', params.secret)
    .update(params.domain)
    .update('\0')
    .update(params.action)
    .update('\0')
    .update(params.scope)
    .update('\0')
    .update(params.identifier)
    .digest('hex');
}

/**
 * Consumes one request from a fixed-window rate limit.
 *
 * Resolves when the request is allowed. Throws `RateLimitExceededError` when the
 * request should be blocked, or `RateLimitUnavailableError` when the backing
 * store fails. Background pruning is intentionally non-blocking.
 */
export async function checkRateLimit<Action extends string, Scope extends string>(
  params: CheckRateLimitParams<Action, Scope>,
): Promise<void> {
  validatePolicy(params);

  const now = params.now ?? new Date();
  const windowStart = windowStartFor(now, params.windowSeconds);
  const expiresAt = secondsAfter(windowStart, params.windowSeconds);
  const identifierHmac = hashRateLimitIdentifier({
    action: params.action,
    scope: params.scope,
    identifier: params.identifier,
    secret: params.identifierSecret,
    domain: params.identifierHashDomain,
  });
  const identifierHmacPrefix = identifierHmac.slice(
    0,
    params.identifierHmacPrefixLength ?? DEFAULT_HASH_PREFIX_LENGTH,
  );

  let result: ConsumeRateLimitResult;
  try {
    result = await params.consume({
      action: params.action,
      scope: params.scope,
      identifierHmac,
      windowStart,
      expiresAt,
      timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  } catch (error) {
    params.onCheck?.({action: params.action, scope: params.scope, outcome: 'unavailable'});
    throw new RateLimitUnavailableError({
      action: params.action,
      scope: params.scope,
      identifierHmacPrefix,
      cause: error,
    });
  }

  if (result.count > params.limit) {
    params.onCheck?.({action: params.action, scope: params.scope, outcome: 'blocked'});
    throw new RateLimitExceededError({
      action: params.action,
      scope: params.scope,
      retryAfterSeconds: retryAfterSeconds(now, result.expiresAt),
      identifierHmacPrefix,
    });
  }

  params.onCheck?.({action: params.action, scope: params.scope, outcome: 'allowed'});

  if (params.prune) {
    void Promise.resolve()
      .then(() => params.prune?.({now}))
      .catch(() => {
        params.onPruneFailure?.();
      });
  }
}

function validatePolicy(policy: RateLimitPolicy): void {
  if (!Number.isFinite(policy.limit) || policy.limit <= 0) {
    throw new RateLimitPolicyError('Rate limit must be a positive finite number');
  }

  if (!Number.isFinite(policy.windowSeconds) || policy.windowSeconds <= 0) {
    throw new RateLimitPolicyError('Rate limit windowSeconds must be a positive finite number');
  }
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function retryAfterSeconds(now: Date, expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000));
}
