import type {
  InterModuleCallOptions,
  InterModuleHandlerContext,
  InterModuleKnownError,
  InterModuleMethodContract,
} from '@shipfox/inter-module';
import {markErrorReported} from '@shipfox/node-error-monitoring';
import {logger, type Span, SpanKind, type trace} from '@shipfox/node-opentelemetry';
import {InterModuleOpaqueError, InterModuleValidationError} from './errors.js';
import {isJsonSafeValue} from './json.js';
import {reviveThrownKnownError} from './known-error-revive.js';
import {
  endInterModuleSpan,
  type InterModuleOutcome,
  startActiveInterModuleSpan,
} from './tracing.js';

export type InterModuleInternalErrorPhase =
  | 'input-schema'
  | 'input-contract'
  | 'handler'
  | 'known-error-contract'
  | 'output-schema'
  | 'output-contract'
  | 'serialization';

export type InterModuleReportInternalError = (
  error: unknown,
  context: {phase: InterModuleInternalErrorPhase; module: string; method: string},
) => void | Promise<void>;

export type InterModuleHandlerFn = (input: unknown, context: InterModuleHandlerContext) => unknown;

/**
 * Fires `reportInternalError` without ever blocking the caller on it: a
 * reporter that returns a promise that never settles must not hang the
 * dispatch boundary. Any synchronous throw or eventual async rejection is
 * drained: the reporter's own failure never affects the caller's outcome.
 */
function drainReport(
  reportInternalError: InterModuleReportInternalError,
  error: unknown,
  context: {phase: InterModuleInternalErrorPhase; module: string; method: string},
): void {
  try {
    const result = reportInternalError(error, context);
    if (result && typeof result.then === 'function') {
      result.then(undefined, (reporterError) => {
        logger().warn({err: reporterError}, 'Inter-module internal error reporter failed');
      });
    }
  } catch (reporterError) {
    // The reporter's own synchronous failure never affects the caller's outcome.
    logger().warn({err: reporterError}, 'Inter-module internal error reporter failed');
  }
}

type InterModuleInputResolution =
  | {kind: 'valid'; value: unknown}
  | {kind: 'validation-error'}
  | {kind: 'opaque-error'; phase: InterModuleInternalErrorPhase; reportError: unknown};

/**
 * The input half of the dispatch boundary: a raw JSON guard, synchronous
 * schema validation, a parsed-value JSON guard, and a JSON copy severing
 * shared references.
 */
function resolveInterModuleInput(
  methodContract: InterModuleMethodContract,
  rawInput: unknown,
): InterModuleInputResolution {
  if (!isJsonSafeValue(rawInput)) {
    return {kind: 'validation-error'};
  }

  const inputParse = safeParseWithDefectDetection(methodContract.input, rawInput);
  if (inputParse.kind === 'defect') {
    return {kind: 'opaque-error', phase: 'input-schema', reportError: inputParse.error};
  }
  if (inputParse.kind === 'invalid') {
    return {kind: 'validation-error'};
  }

  if (!isJsonSafeValue(inputParse.data)) {
    return {
      kind: 'opaque-error',
      phase: 'input-contract',
      reportError: new Error('Parsed input is not JSON-safe'),
    };
  }

  try {
    return {kind: 'valid', value: JSON.parse(JSON.stringify(inputParse.data))};
  } catch (error) {
    return {kind: 'opaque-error', phase: 'serialization', reportError: error};
  }
}

export interface RunInterModuleCallOptions {
  module: string;
  method: string;
  input: unknown;
  options: InterModuleCallOptions | undefined;
  methodContract: InterModuleMethodContract;
  handler: InterModuleHandlerFn;
  tracer: ReturnType<typeof trace.getTracer>;
  transportName: string;
  reportInternalError: InterModuleReportInternalError;
  hasInternalReporter: boolean;
}

/**
 * Runs one call across the full dispatch boundary in a single process: input
 * resolution, a cancellation-aware handler invocation, and output validation.
 * Resolves with the method's output or rejects with a known error, a
 * validation rejection, an opaque failure, or the call's `AbortSignal` reason.
 *
 * The client and the presentation share one call stack, so each gets its own
 * `INTERNAL` span.
 */
export function runInterModuleCall(callOptions: RunInterModuleCallOptions): Promise<unknown> {
  const {module, method, methodContract, tracer, transportName, reportInternalError} = callOptions;
  const endSpan = (span: Span, outcome: InterModuleOutcome, knownErrorCode?: string) =>
    endInterModuleSpan(span, {module, method, transport: transportName, outcome, knownErrorCode});

  try {
    // The presentation span is started *inside* this callback (not as a
    // sibling call) so it activates as the client span's child. A span
    // merely created via `startSpan` never becomes the parent of a later,
    // separately created span; only an *active* span does. Both callbacks may
    // throw synchronously (e.g. a pre-aborted signal); the surrounding
    // try/catch here converts that into a rejected promise instead of a
    // synchronous throw from this function.
    return startActiveInterModuleSpan(
      tracer,
      'inter_module.client',
      SpanKind.INTERNAL,
      (clientSpan) => {
        const signal = callOptions.options?.signal;
        if (signal?.aborted) {
          // Cancellation wins over everything else, including input validation: a
          // pre-aborted call rejects with the signal's own reason, not a validation
          // rejection derived from input the caller no longer wants processed.
          endSpan(clientSpan, 'cancelled');
          throw signal.reason;
        }

        const inputResolution = resolveInterModuleInput(methodContract, callOptions.input);
        if (inputResolution.kind !== 'valid') {
          if (inputResolution.kind === 'opaque-error') {
            drainReport(reportInternalError, inputResolution.reportError, {
              phase: inputResolution.phase,
              module,
              method,
            });
          }
          endSpan(clientSpan, inputResolution.kind);
          throw inputResolution.kind === 'validation-error'
            ? new InterModuleValidationError(module, method)
            : createOpaqueError(callOptions);
        }

        return runInterModulePresentation({
          callOptions,
          input: inputResolution.value,
          clientSpan,
          endSpan,
        });
      },
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

function runInterModulePresentation(params: {
  callOptions: RunInterModuleCallOptions;
  input: unknown;
  clientSpan: Span;
  endSpan(span: Span, outcome: InterModuleOutcome, knownErrorCode?: string): void;
}): Promise<unknown> {
  const {callOptions} = params;
  return startActiveInterModuleSpan(
    callOptions.tracer,
    'inter_module.presentation',
    SpanKind.INTERNAL,
    async (presentationSpan) => {
      const settlement = await invokeHandlerWithCancellation({
        methodContract: callOptions.methodContract,
        handler: callOptions.handler,
        input: params.input,
        signal: callOptions.options?.signal,
      });
      reportOpaqueSettlement(callOptions, settlement);
      const outcome = settlement.outcome === 'opaque' ? 'opaque-error' : settlement.outcome;
      const knownErrorCode =
        settlement.outcome === 'known-error' ? settlement.error.code : undefined;
      params.endSpan(presentationSpan, outcome, knownErrorCode);
      params.endSpan(params.clientSpan, outcome, knownErrorCode);
      if (settlement.outcome === 'success') return settlement.value;
      if (settlement.outcome === 'known-error') throw settlement.error;
      if (settlement.outcome === 'cancelled') throw settlement.reason;
      throw createOpaqueError(callOptions);
    },
  );
}

function reportOpaqueSettlement(
  callOptions: RunInterModuleCallOptions,
  settlement: Awaited<ReturnType<typeof invokeHandlerWithCancellation>>,
): void {
  if (settlement.outcome !== 'opaque') return;
  drainReport(callOptions.reportInternalError, settlement.reportError, {
    phase: settlement.phase,
    module: callOptions.module,
    method: callOptions.method,
  });
}

function createOpaqueError(callOptions: RunInterModuleCallOptions): InterModuleOpaqueError {
  const error = new InterModuleOpaqueError(callOptions.module, callOptions.method);
  if (callOptions.hasInternalReporter) markErrorReported(error);
  return error;
}

type SafeParseResult =
  | {kind: 'valid'; data: unknown}
  | {kind: 'invalid'}
  | {kind: 'defect'; error: unknown};

/**
 * Runs `schema.safeParse(value)`, classifying a schema that throws instead of
 * returning `{success: false}` (e.g. one that behaves asynchronously) as a
 * `defect` rather than letting the exception escape. Shared by both halves of
 * the dispatch boundary (input and output validation).
 */
function safeParseWithDefectDetection(
  schema: InterModuleMethodContract['input'],
  value: unknown,
): SafeParseResult {
  try {
    const result = schema.safeParse(value);
    if (!result.success) return {kind: 'invalid'};
    return {kind: 'valid', data: result.data};
  } catch (error) {
    return {kind: 'defect', error};
  }
}

type HandlerSettlement =
  | {outcome: 'success'; value: unknown}
  | {outcome: 'known-error'; error: InterModuleKnownError}
  | {outcome: 'opaque'; phase: InterModuleInternalErrorPhase; reportError: unknown}
  | {outcome: 'cancelled'; reason: unknown};

/**
 * The producer half of the dispatch boundary: races the handler's settlement
 * against `signal`, revives a declared known error into a fresh copy, and
 * validates and copies a successful output. Never throws: the caller
 * translates the returned settlement into its own rejection or resolution.
 */
async function invokeHandlerWithCancellation(params: {
  methodContract: InterModuleMethodContract;
  handler: InterModuleHandlerFn;
  input: unknown;
  signal: AbortSignal | undefined;
}): Promise<HandlerSettlement> {
  const {methodContract, handler, input, signal} = params;

  if (signal?.aborted) {
    return {outcome: 'cancelled', reason: signal.reason};
  }

  // Registered before the handler is ever invoked (below): a handler that
  // synchronously triggers its own signal's abort as a side effect of starting
  // up must still be observed, not missed because no listener existed yet.
  let onAbort: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<HandlerSettlement>((resolve) => {
        onAbort = () => resolve({outcome: 'cancelled', reason: signal.reason});
        signal.addEventListener('abort', onAbort, {once: true});
      })
    : undefined;

  try {
    const context: InterModuleHandlerContext = {signal: signal ?? new AbortController().signal};
    // `.then(onFulfilled, onRejected)` is attached synchronously, right here, so
    // the handler's own promise always has a consumer: even if the abort race
    // below settles first, this promise's eventual settlement never surfaces as
    // an unhandled rejection.
    const handlerPromise = invokeHandler(handler, input, context).then(
      (value) => classifyHandlerSuccess(value, methodContract),
      (thrown) => classifyHandlerError(thrown, methodContract),
    );

    return abortPromise ? await Promise.race([handlerPromise, abortPromise]) : await handlerPromise;
  } finally {
    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
  }
}

function invokeHandler(
  handler: InterModuleHandlerFn,
  input: unknown,
  context: InterModuleHandlerContext,
): Promise<unknown> {
  try {
    return Promise.resolve(handler(input, context));
  } catch (error) {
    return Promise.reject(error);
  }
}

function classifyHandlerSuccess(
  value: unknown,
  methodContract: InterModuleMethodContract,
): HandlerSettlement {
  const outputParse = safeParseWithDefectDetection(methodContract.output, value);
  if (outputParse.kind === 'defect') {
    return {outcome: 'opaque', phase: 'output-schema', reportError: outputParse.error};
  }
  if (outputParse.kind === 'invalid') {
    return {
      outcome: 'opaque',
      phase: 'output-schema',
      reportError: new Error(
        `Handler output failed contract validation for ${methodContract.module}.${methodContract.method}`,
      ),
    };
  }

  if (!isJsonSafeValue(outputParse.data)) {
    return {
      outcome: 'opaque',
      phase: 'output-contract',
      reportError: new Error(
        `Handler output is not JSON-safe for ${methodContract.module}.${methodContract.method}`,
      ),
    };
  }

  try {
    const copy = JSON.parse(JSON.stringify(outputParse.data));
    return {outcome: 'success', value: copy};
  } catch (error) {
    return {outcome: 'opaque', phase: 'serialization', reportError: error};
  }
}

function classifyHandlerError(
  thrown: unknown,
  methodContract: InterModuleMethodContract,
): HandlerSettlement {
  const revival = reviveThrownKnownError(methodContract, thrown);
  if (revival.outcome === 'known-error') return {outcome: 'known-error', error: revival.error};
  if (revival.outcome === 'known-error-contract-defect') {
    return {outcome: 'opaque', phase: 'known-error-contract', reportError: thrown};
  }
  return {outcome: 'opaque', phase: 'handler', reportError: thrown};
}
