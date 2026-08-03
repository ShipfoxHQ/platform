import {type Span, type SpanKind, SpanStatusCode, trace} from '@shipfox/node-opentelemetry';

const TRACER_NAME = '@shipfox/node-module/inter-module';

export type InterModuleOutcome =
  | 'success'
  | 'known-error'
  | 'validation-error'
  | 'opaque-error'
  | 'cancelled';

export function resolveInterModuleTracer(
  tracer?: ReturnType<typeof trace.getTracer>,
): ReturnType<typeof trace.getTracer> {
  return tracer ?? trace.getTracer(TRACER_NAME);
}

/**
 * Runs `fn` with `name` activated as the current span for its duration. This
 * is required whenever `fn` itself creates further spans that must nest under
 * it: `tracer.startSpan` alone leaves two sequentially created spans as
 * unrelated siblings; only an active span is picked up as the parent context
 * for spans started later.
 */
export function startActiveInterModuleSpan<T>(
  tracer: ReturnType<typeof trace.getTracer>,
  name: string,
  kind: (typeof SpanKind)[keyof typeof SpanKind],
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, {kind}, fn);
}

/**
 * Sets only stable, bounded attributes (module, method, transport, outcome, and
 * the code for a known error) and ends the span. Never attach payloads,
 * identifiers, messages, stacks, causes, or raw exception events to a span.
 */
export function endInterModuleSpan(
  span: Span,
  attributes: {
    module: string;
    method: string;
    transport: string;
    outcome: InterModuleOutcome;
    knownErrorCode?: string | undefined;
  },
): void {
  span.setAttribute('inter_module.module', attributes.module);
  span.setAttribute('inter_module.method', attributes.method);
  span.setAttribute('inter_module.transport', attributes.transport);
  span.setAttribute('inter_module.outcome', attributes.outcome);
  if (attributes.knownErrorCode !== undefined) {
    span.setAttribute('inter_module.known_error_code', attributes.knownErrorCode);
  }
  span.setStatus({
    code: attributes.outcome === 'opaque-error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
  });
  span.end();
}
