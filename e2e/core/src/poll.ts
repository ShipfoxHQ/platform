export interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  describe: () => string;
  /** Stops polling early (used to fail fast when the polled process dies). */
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_MAX_INTERVAL_MS = 2_000;
const DEFAULT_BACKOFF_FACTOR = 2;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PollTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly description: string;
  readonly lastError: unknown;

  constructor(params: {timeoutMs: number; description: string; lastError?: unknown}) {
    const suffix =
      params.lastError === undefined ? '' : `; last error: ${errorMessage(params.lastError)}`;
    super(`Timed out after ${params.timeoutMs}ms waiting for ${params.description}${suffix}`);
    this.name = 'PollTimeoutError';
    this.timeoutMs = params.timeoutMs;
    this.description = params.description;
    this.lastError = params.lastError;
  }
}

/**
 * Polls `probe` with exponential backoff until it returns a non-null value or the
 * budget runs out. On timeout it throws an error that ends with `describe()`, so
 * callers surface the last state they observed rather than a bare deadline. An
 * aborted signal also ends the poll with that same descriptive error.
 */
export async function pollUntil<T>(
  options: PollOptions,
  probe: () => Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let delay = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const backoffFactor = Math.max(1, options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR);
  let lastError: unknown;

  for (;;) {
    if (options.signal?.aborted) {
      throw new Error(`Stopped waiting for ${options.describe()}`);
    }

    try {
      const result = await probe();
      if (result !== null) return result;
    } catch (error) {
      lastError = error;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new PollTimeoutError({
        timeoutMs: options.timeoutMs,
        description: options.describe(),
        lastError,
      });
    }

    await sleep(Math.min(delay, remaining), options.signal);
    delay = Math.min(Math.ceil(delay * backoffFactor), maxIntervalMs);
  }
}
