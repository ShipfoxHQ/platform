import {instanceMetrics, logger} from '@shipfox/node-opentelemetry';
import {interruptibleSleep, nextBackoffInterval, withJitter} from '@shipfox/node-resilient-loop';
import type {InferenceCredential, InferenceCredentialSource} from '@shipfox/runner-agent';
import {
  AgentRuntimeConfigRequestError,
  type AgentRuntimeConfigResponse,
  type AgentRuntimeConfigResponseTiming,
  isTransientAgentRuntimeConfigError,
} from '@shipfox/runner-protocol';

const meter = instanceMetrics.getMeter('runner-orchestration');

export type InferenceRefreshTrigger = 'refresh-at' | 'rejected-generation' | 'expired';
export type InferenceRefreshOutcome =
  | 'refreshed'
  | 'current-used'
  | 'unavailable'
  | 'denied'
  | 'invalid';
export type InferenceClockSource = 'server-date' | 'local-fallback';

const inferenceRefreshCount = meter.createCounter<{
  harness: 'pi' | 'claude';
  trigger: InferenceRefreshTrigger;
  outcome: InferenceRefreshOutcome;
  clock_source: InferenceClockSource;
}>('runner_inference_credential_refreshes', {
  description: 'Managed inference credential refresh outcomes by bounded runner dimensions',
});

const inferenceRefreshDuration = meter.createHistogram<{
  harness: 'pi' | 'claude';
  outcome: InferenceRefreshOutcome;
}>('runner_inference_credential_refresh_duration', {
  description: 'Managed inference credential refresh duration',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0, 10, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000],
  },
});

const inferenceCredentialRemainingDuration = meter.createHistogram<{
  harness: 'pi' | 'claude';
  outcome: 'current' | 'refreshed' | 'fallback';
}>('runner_inference_credential_remaining_duration', {
  description: 'Remaining validity of a managed inference credential returned to a harness',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [0, 30_000, 60_000, 120_000, 300_000, 600_000],
  },
});

const inferenceCredentialClockFallbackCount = meter.createCounter<{
  harness: 'pi' | 'claude';
  reason: ClockFallbackReason;
}>('runner_inference_credential_clock_fallbacks', {
  description: 'Managed inference credential deadline calculations using the local clock',
});

export const INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS = 30_000;
export const INFERENCE_CREDENTIAL_FALLBACK_SKEW_RESERVE_MS = 30_000;
export const MAX_INFERENCE_CREDENTIAL_GENERATIONS = 3;

const DEFAULT_REFRESH_TIMEOUT_MS = 8_000;
const DEFAULT_REFRESH_ATTEMPTS = 3;
const DEFAULT_REFRESH_BACKOFF_MS = 250;
const MAX_REFRESH_BACKOFF_MS = 2_000;
const ISO_CALENDAR_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})T/;

type RuntimeConfig = AgentRuntimeConfigResponse['config'];

export type InferenceRuntimeConfigFetch = (params: {
  signal: AbortSignal;
}) => Promise<AgentRuntimeConfigResponse>;

export type InferenceCredentialSourceOptions = {
  initial: AgentRuntimeConfigResponse;
  signal: AbortSignal;
  fetchRuntimeConfig: InferenceRuntimeConfigFetch;
  replaceInferenceSecrets?: (secrets: string[]) => void;
  monotonicNow?: () => number;
  wallClockNow?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  refreshTimeoutMs?: number;
  refreshAttempts?: number;
  refreshBackoffMs?: number;
  refreshMaxBackoffMs?: number;
};

export type MonotonicCredentialDeadlines = {
  refreshAt: number;
  expiresAt: number;
  clockSource: InferenceClockSource;
};

export type ClockFallbackReason = 'missing' | 'invalid';

export function deriveMonotonicCredentialDeadlines(
  config: RuntimeConfig,
  timing: AgentRuntimeConfigResponseTiming,
  options: {
    wallClockNow?: () => number;
    onClockFallback?: (reason: ClockFallbackReason) => void;
  } = {},
): MonotonicCredentialDeadlines {
  const expiry = parseTimestamp(config.expires_at);
  const refreshAt = parseTimestamp(
    config.renewal?.mode === 'refresh-at' ? config.renewal.refresh_at : undefined,
  );
  if (expiry === undefined || refreshAt === undefined || refreshAt >= expiry) {
    throw new InferenceCredentialProtocolError('Invalid inference credential renewal window');
  }

  const requestStartedAt = finiteNumber(timing.requestStartedAt);
  const responseReceivedAt = finiteNumber(timing.responseReceivedAt);
  const wallClockAtReceipt = finiteNumber(
    timing.wallClockAtReceipt === undefined
      ? (options.wallClockNow ?? (() => Date.now()))()
      : timing.wallClockAtReceipt,
  );
  if (
    requestStartedAt === undefined ||
    responseReceivedAt === undefined ||
    wallClockAtReceipt === undefined
  ) {
    throw new InferenceCredentialProtocolError('Invalid inference credential response timing');
  }

  const serverDate = parseTimestamp(timing.serverDate);
  if (serverDate !== undefined) {
    return {
      refreshAt: requestStartedAt + refreshAt - serverDate,
      expiresAt: requestStartedAt + expiry - serverDate,
      clockSource: 'server-date',
    };
  }

  options.onClockFallback?.(timing.serverDate === undefined ? 'missing' : 'invalid');
  return {
    refreshAt:
      responseReceivedAt +
      refreshAt -
      wallClockAtReceipt -
      INFERENCE_CREDENTIAL_FALLBACK_SKEW_RESERVE_MS,
    expiresAt:
      responseReceivedAt +
      expiry -
      wallClockAtReceipt -
      INFERENCE_CREDENTIAL_FALLBACK_SKEW_RESERVE_MS,
    clockSource: 'local-fallback',
  };
}

export function createInferenceCredentialSource(
  options: InferenceCredentialSourceOptions,
): InferenceCredentialSource | undefined {
  if (!hasRenewableMetadata(options.initial.config)) return undefined;
  // The on-rejection mode remains on the compatibility path used by legacy
  // managed credentials. Proactive inference renewal requires a server refresh
  // deadline, so only the refresh-at contract installs this source.
  if (options.initial.config.renewal?.mode !== 'refresh-at') return undefined;
  return new RenewableInferenceCredentialSource(options);
}

export class InferenceCredentialSourceClosedError extends Error {
  constructor() {
    super('Inference credential source is closed');
    this.name = 'InferenceCredentialSourceClosedError';
  }
}

export class InferenceCredentialUnavailableError extends Error {
  constructor(options?: {cause?: unknown}) {
    super('Renewable inference credentials are temporarily unavailable', options);
    this.name = 'InferenceCredentialUnavailableError';
  }
}

export class InferenceCredentialProtocolError extends Error {
  constructor(message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'InferenceCredentialProtocolError';
  }
}

export class InferenceCredentialIdentityMismatchError extends InferenceCredentialProtocolError {
  constructor() {
    super('Runtime identity changed during inference credential renewal');
    this.name = 'InferenceCredentialIdentityMismatchError';
  }
}

export class RenewableInferenceCredentialSource implements InferenceCredentialSource {
  private readonly signalController = new AbortController();
  private readonly signal: AbortSignal;
  private readonly monotonicNow: () => number;
  private readonly wallClockNow: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly refreshTimeoutMs: number;
  private readonly refreshAttempts: number;
  private readonly refreshBackoffMs: number;
  private readonly refreshMaxBackoffMs: number;
  private readonly identity: RuntimeIdentity;
  private readonly harness: 'pi' | 'claude';
  private readonly jobAbort: () => void;
  private current: CredentialState;
  private generations: GenerationSecrets[];
  private refreshFlight: Promise<InferenceCredential> | undefined;
  private closed = false;
  private fallbackWarningEmitted = false;

  constructor(private readonly options: InferenceCredentialSourceOptions) {
    this.harness = requireHarness(options.initial.config);
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.wallClockNow = options.wallClockNow ?? (() => Date.now());
    this.sleep = options.sleep ?? interruptibleSleep;
    this.random = options.random ?? Math.random;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
    this.refreshAttempts = options.refreshAttempts ?? DEFAULT_REFRESH_ATTEMPTS;
    this.refreshBackoffMs = options.refreshBackoffMs ?? DEFAULT_REFRESH_BACKOFF_MS;
    this.refreshMaxBackoffMs = options.refreshMaxBackoffMs ?? MAX_REFRESH_BACKOFF_MS;
    validatePositiveInteger(this.refreshAttempts, 'refreshAttempts');
    validateNonNegativeFinite(this.refreshBackoffMs, 'refreshBackoffMs');
    validateNonNegativeFinite(this.refreshMaxBackoffMs, 'refreshMaxBackoffMs');
    validatePositiveFinite(this.refreshTimeoutMs, 'refreshTimeoutMs');
    this.signal = AbortSignal.any([options.signal, this.signalController.signal]);
    this.jobAbort = () => this.close();
    this.identity = runtimeIdentity(options.initial.config);
    const state = this.stateFromResponse(options.initial);
    this.current = state;
    this.generations = [{generation: state.generation, secrets: state.secrets}];
    options.signal.addEventListener('abort', this.jobAbort, {once: true});
    if (options.signal.aborted) {
      this.close();
      return;
    }
    try {
      this.publishSecrets(this.publishedSecrets());
    } catch (error) {
      this.close();
      throw error;
    }
  }

  resolve(options?: {
    readonly rejectedGeneration?: string | undefined;
  }): Promise<InferenceCredential> {
    try {
      this.assertOpen();
      const rejectedGeneration = options?.rejectedGeneration;
      const now = this.monotonicNow();
      const remaining = this.current.expiresAt - now;
      const rejectedCurrent =
        rejectedGeneration !== undefined && rejectedGeneration === this.current.generation;
      const rejectedStale =
        rejectedGeneration !== undefined && rejectedGeneration !== this.current.generation;

      if (rejectedStale && remaining >= INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS) {
        return Promise.resolve(this.recordCurrent('current', remaining));
      }

      const refreshDue = now >= this.current.refreshAt;
      const safetyRefreshDue = remaining < INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS;
      if (!rejectedCurrent && !refreshDue && !safetyRefreshDue) {
        return Promise.resolve(this.recordCurrent('current', remaining));
      }

      let trigger: InferenceRefreshTrigger;
      if (rejectedCurrent) {
        trigger = 'rejected-generation';
      } else if (now >= this.current.expiresAt) {
        trigger = 'expired';
      } else {
        trigger = 'refresh-at';
      }
      const generationBeforeRefresh = this.current.generation;
      const flight = this.refreshFlight ?? this.startRefresh(trigger);
      return flight.then((credential) => {
        this.assertOpen();
        const current = this.current;
        const currentRemaining = current.expiresAt - this.monotonicNow();
        return this.recordCurrent(
          credential.generation === generationBeforeRefresh ? 'fallback' : 'refreshed',
          currentRemaining,
        );
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.options.signal.removeEventListener('abort', this.jobAbort);
    this.signalController.abort('source-closed');
    try {
      this.options.replaceInferenceSecrets?.([]);
    } catch {
      // Cleanup must not keep a completed or cancelled step alive.
    }
  }

  private startRefresh(trigger: InferenceRefreshTrigger): Promise<InferenceCredential> {
    const existing = this.refreshFlight;
    if (existing !== undefined) return existing;

    const startedAt = this.monotonicNow();
    const flight = this.performRefresh(trigger, startedAt).finally(() => {
      if (this.refreshFlight === flight) this.refreshFlight = undefined;
    });
    this.refreshFlight = flight;
    return flight;
  }

  private async performRefresh(
    trigger: InferenceRefreshTrigger,
    startedAt: number,
  ): Promise<InferenceCredential> {
    let backoffMs = this.refreshBackoffMs;
    let lastError: unknown;

    for (let attempt = 0; attempt < this.refreshAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout();
        this.assertOpen();
        const next = this.stateFromResponse(response);
        this.assertIdentity(next.identity);
        if (this.generations.some((generation) => generation.generation === next.generation)) {
          throw new InferenceCredentialProtocolError(
            'Inference credential renewal did not advance its generation',
          );
        }
        if (next.expiresAt - this.monotonicNow() < INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS) {
          throw new InferenceCredentialUnavailableError();
        }

        const nextGenerations = [
          {generation: next.generation, secrets: next.secrets},
          ...this.generations,
        ].slice(0, MAX_INFERENCE_CREDENTIAL_GENERATIONS);
        this.publishSecrets(flattenGenerationSecrets(nextGenerations));
        this.current = next;
        this.generations = nextGenerations;
        recordRefresh(
          this.harness,
          trigger,
          'refreshed',
          next.clockSource,
          this.monotonicNow() - startedAt,
        );
        return toCredential(next);
      } catch (error) {
        this.assertNotAborted();
        lastError = error;
        const transient =
          error instanceof InferenceCredentialUnavailableError ||
          isTransientAgentRuntimeConfigError(error);
        if (!transient || attempt + 1 >= this.refreshAttempts) break;
        try {
          await this.sleep(
            withJitter(backoffMs, {minFactor: 0.5, maxFactor: 1.5, random: this.random}),
            this.signal,
          );
        } catch (sleepError) {
          this.assertNotAborted();
          throw sleepError;
        }
        this.assertOpen();
        backoffMs = nextBackoffInterval(backoffMs, {
          maxMs: this.refreshMaxBackoffMs,
          factor: 2,
        });
      }
    }

    return this.handleRefreshFailure(trigger, startedAt, lastError);
  }

  private async fetchWithTimeout(): Promise<AgentRuntimeConfigResponse> {
    this.assertOpen();
    const controller = new AbortController();
    const abortFromSource = () => controller.abort(this.signal.reason);
    let rejectOnAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new InferenceCredentialSourceClosedError());
      if (this.signal.aborted) {
        rejectOnAbort();
        return;
      }
      this.signal.addEventListener('abort', rejectOnAbort, {once: true});
    });
    this.signal.addEventListener('abort', abortFromSource, {once: true});
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const request = Promise.resolve().then(() => {
      this.assertOpen();
      return this.options.fetchRuntimeConfig({signal: controller.signal});
    });
    void request.catch(() => undefined);
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort('refresh-timeout');
        reject(new InferenceCredentialUnavailableError());
      }, this.refreshTimeoutMs);
    });

    try {
      return await Promise.race([request, timeoutPromise, abortPromise]);
    } catch (error) {
      if (timedOut && !this.signal.aborted) {
        throw new InferenceCredentialUnavailableError({cause: error});
      }
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      this.signal.removeEventListener('abort', abortFromSource);
      if (rejectOnAbort !== undefined) {
        this.signal.removeEventListener('abort', rejectOnAbort);
      }
      controller.abort();
    }
  }

  private handleRefreshFailure(
    trigger: InferenceRefreshTrigger,
    startedAt: number,
    error: unknown,
  ): InferenceCredential {
    this.assertOpen();
    const currentRemaining = this.current.expiresAt - this.monotonicNow();
    const safeToUseCurrent = currentRemaining >= INFERENCE_CREDENTIAL_SAFETY_WINDOW_MS;
    const rejectedRefresh = trigger === 'rejected-generation';
    const outcome = refreshFailureOutcome(error, safeToUseCurrent && !rejectedRefresh);
    recordRefresh(
      this.harness,
      trigger,
      outcome,
      this.current.clockSource,
      this.monotonicNow() - startedAt,
    );

    if (
      safeToUseCurrent &&
      !rejectedRefresh &&
      !(error instanceof InferenceCredentialIdentityMismatchError) &&
      isRetainableRefreshFailure(error)
    ) {
      return this.recordCurrent('fallback', currentRemaining);
    }
    if (isTransientRefreshFailure(error) && !safeToUseCurrent) {
      throw new InferenceCredentialUnavailableError({cause: error});
    }
    throw error;
  }

  private stateFromResponse(response: AgentRuntimeConfigResponse): CredentialState {
    const config = response.config;
    const token = config.credentials.api_key;
    if (token === undefined || token.length === 0) {
      throw new InferenceCredentialProtocolError('Renewable inference credentials lack api_key');
    }
    if (config.claude !== undefined && config.claude.auth_token !== token) {
      throw new InferenceCredentialProtocolError('Renewable inference credential aliases differ');
    }
    const generation = config.generation;
    if (generation === undefined || generation.length === 0 || !hasRenewableMetadata(config)) {
      throw new InferenceCredentialProtocolError(
        'Incomplete renewable inference credential metadata',
      );
    }
    const deadlines = deriveMonotonicCredentialDeadlines(config, response.timing, {
      wallClockNow: this.wallClockNow,
      onClockFallback: (reason) => this.recordClockFallback(reason),
    });
    return {
      token,
      generation,
      ...deadlines,
      identity: runtimeIdentity(config),
      secrets: runtimeSecrets(config),
    };
  }

  private assertIdentity(identity: RuntimeIdentity): void {
    if (!sameRuntimeIdentity(this.identity, identity)) {
      throw new InferenceCredentialIdentityMismatchError();
    }
  }

  private currentCredential(): InferenceCredential {
    return toCredential(this.current);
  }

  private recordCurrent(
    outcome: 'current' | 'refreshed' | 'fallback',
    remaining: number,
  ): InferenceCredential {
    recordRemainingDuration(this.harness, outcome, remaining);
    return this.currentCredential();
  }

  private publishSecrets(secrets: string[]): void {
    try {
      this.options.replaceInferenceSecrets?.(secrets);
    } catch (error) {
      throw new InferenceCredentialProtocolError('Inference secret registration failed', {
        cause: error,
      });
    }
  }

  private publishedSecrets(): string[] {
    return flattenGenerationSecrets(this.generations);
  }

  private recordClockFallback(reason: ClockFallbackReason): void {
    recordClockFallbackMetric(this.harness, reason);
    if (this.fallbackWarningEmitted) return;
    this.fallbackWarningEmitted = true;
    logger().warn(
      {harness: this.harness, reason},
      'Agent runtime config Date header missing or invalid; using local clock fallback',
    );
  }

  private assertOpen(): void {
    if (this.closed || this.signal.aborted) throw new InferenceCredentialSourceClosedError();
  }

  private assertNotAborted(): void {
    if (this.closed || this.signal.aborted) throw new InferenceCredentialSourceClosedError();
  }
}

type CredentialState = {
  token: string;
  generation: string;
  refreshAt: number;
  expiresAt: number;
  clockSource: InferenceClockSource;
  identity: RuntimeIdentity;
  secrets: string[];
};

type GenerationSecrets = {
  generation: string;
  secrets: string[];
};

type RuntimeIdentity = {
  harness: string;
  providerId: string;
  model: string;
  thinking: string;
  customApi: string | undefined;
  customBaseUrl: string | undefined;
  customModel: string | undefined;
  claudeBaseUrl: string | undefined;
};

function hasRenewableMetadata(config: RuntimeConfig): boolean {
  const hasExpiry = config.expires_at !== undefined;
  const hasGeneration = config.generation !== undefined;
  const hasRenewal = config.renewal !== undefined;
  const hasAny = hasExpiry || hasGeneration || hasRenewal;
  if (!hasAny) return false;
  if (!(hasExpiry && hasGeneration && hasRenewal)) {
    throw new InferenceCredentialProtocolError(
      'Incomplete renewable inference credential metadata',
    );
  }
  return true;
}

function requireHarness(config: RuntimeConfig): 'pi' | 'claude' {
  if (config.harness === 'pi' || config.harness === 'claude') return config.harness;
  throw new InferenceCredentialProtocolError('Unsupported inference harness');
}

function runtimeIdentity(config: RuntimeConfig): RuntimeIdentity {
  return {
    harness: config.harness,
    providerId: config.provider_id,
    model: config.model,
    thinking: config.thinking,
    customApi: config.custom_provider?.api,
    customBaseUrl:
      config.custom_provider === undefined
        ? undefined
        : normalizeUrl(config.custom_provider.base_url),
    customModel:
      config.custom_provider === undefined
        ? undefined
        : selectedModelDescriptor(config.custom_provider.models, config.model),
    claudeBaseUrl: config.claude === undefined ? undefined : normalizeUrl(config.claude.base_url),
  };
}

function selectedModelDescriptor(
  models: NonNullable<RuntimeConfig['custom_provider']>['models'],
  model: string,
): string | undefined {
  const selected = models.find((candidate) => candidate.id === model);
  return selected === undefined ? undefined : JSON.stringify(selected);
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch (error) {
    throw new InferenceCredentialProtocolError('Invalid runtime gateway URL', {cause: error});
  }
}

function sameRuntimeIdentity(left: RuntimeIdentity, right: RuntimeIdentity): boolean {
  return (
    left.harness === right.harness &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.thinking === right.thinking &&
    left.customApi === right.customApi &&
    left.customBaseUrl === right.customBaseUrl &&
    left.customModel === right.customModel &&
    left.claudeBaseUrl === right.claudeBaseUrl
  );
}

function runtimeSecrets(config: RuntimeConfig): string[] {
  return [
    ...new Set([
      ...Object.values(config.credentials),
      ...(config.claude === undefined ? [] : [config.claude.auth_token]),
    ]),
  ];
}

function flattenGenerationSecrets(generations: readonly GenerationSecrets[]): string[] {
  return [...new Set(generations.flatMap((generation) => generation.secrets))];
}

function toCredential(state: CredentialState): InferenceCredential {
  return {token: state.token, generation: state.generation};
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const calendarDate = ISO_CALENDAR_DATE_PREFIX.exec(value);
  if (calendarDate !== null && !hasValidCalendarDate(calendarDate)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasValidCalendarDate(match: RegExpExecArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  return daysInMonth !== undefined && day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function finiteNumber(value: number): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${name} must be a positive integer`);
}

function validatePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive and finite`);
}

function validateNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be non-negative and finite`);
  }
}

function isTransientRefreshFailure(error: unknown): boolean {
  return (
    error instanceof InferenceCredentialUnavailableError ||
    isTransientAgentRuntimeConfigError(error)
  );
}

function isRetainableRefreshFailure(error: unknown): boolean {
  return (
    isTransientRefreshFailure(error) ||
    error instanceof InferenceCredentialProtocolError ||
    isInvalidRuntimeConfigError(error)
  );
}

function refreshFailureOutcome(error: unknown, safeCurrent: boolean): InferenceRefreshOutcome {
  if (isInvalidRuntimeConfigError(error)) return 'invalid';
  if (error instanceof AgentRuntimeConfigRequestError) {
    if ([401, 403, 409].includes(error.status)) return 'denied';
    if (safeCurrent) return 'current-used';
    return 'unavailable';
  }
  if (error instanceof InferenceCredentialIdentityMismatchError) return 'invalid';
  if (error instanceof InferenceCredentialProtocolError) return 'invalid';
  if (safeCurrent) return 'current-used';
  return 'unavailable';
}

function isInvalidRuntimeConfigError(error: unknown): boolean {
  return (
    error instanceof AgentRuntimeConfigRequestError && error.code === 'agent-runtime-config-invalid'
  );
}

function recordClockFallbackMetric(_harness: 'pi' | 'claude', _reason: ClockFallbackReason): void {
  try {
    inferenceCredentialClockFallbackCount.add(1, {harness: _harness, reason: _reason});
  } catch {
    // Metrics must not affect credential deadline calculation.
  }
}

function recordRemainingDuration(
  harness: 'pi' | 'claude',
  outcome: 'current' | 'refreshed' | 'fallback',
  remaining: number,
): void {
  try {
    inferenceCredentialRemainingDuration.record(Math.max(0, remaining), {harness, outcome});
  } catch {
    // Metrics must not affect credential resolution.
  }
}

function recordRefresh(
  harness: 'pi' | 'claude',
  trigger: InferenceRefreshTrigger,
  outcome: InferenceRefreshOutcome,
  clockSource: InferenceClockSource,
  duration: number,
): void {
  try {
    inferenceRefreshCount.add(1, {harness, trigger, outcome, clock_source: clockSource});
    inferenceRefreshDuration.record(Math.max(0, duration), {harness, outcome});
  } catch {
    // Metrics must not affect credential resolution.
  }
}
