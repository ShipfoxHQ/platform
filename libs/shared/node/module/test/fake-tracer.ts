import type {trace} from '@shipfox/node-opentelemetry';

export interface FakeSpanRecord {
  name: string;
  kind: unknown;
  attributes: Record<string, unknown>;
  status?: {code: unknown};
  ended: boolean;
  parent?: FakeSpanRecord | undefined;
}

type Tracer = ReturnType<typeof trace.getTracer>;

interface FakeSpan {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: {code: unknown}): void;
  end(): void;
}

/**
 * A hand-written `Tracer` test double: no OpenTelemetry SDK, exporter, or
 * global provider required. Captures every span's name, kind, attributes,
 * status, whether it was ended, and its parent, in creation order.
 *
 * `startActiveSpan` tracks the "current" span with a plain variable reset in a
 * `finally` block, which only correctly nests spans created synchronously
 * within the active callback (not ones created after an `await`): sufficient
 * for this transport's own dispatch code, which never awaits before starting
 * its nested presentation span. A real OpenTelemetry SDK uses
 * `AsyncLocalStorage` instead, which nests correctly across `await` too.
 */
export function createFakeTracer(): {tracer: Tracer; spans: FakeSpanRecord[]} {
  const spans: FakeSpanRecord[] = [];
  let activeSpan: FakeSpanRecord | undefined;

  function createSpan(
    name: string,
    options?: {kind?: unknown},
  ): {record: FakeSpanRecord; span: FakeSpan} {
    const record: FakeSpanRecord = {
      name,
      kind: options?.kind,
      attributes: {},
      ended: false,
      parent: activeSpan,
    };
    spans.push(record);
    const span: FakeSpan = {
      setAttribute(key, value) {
        record.attributes[key] = value;
      },
      setStatus(status) {
        record.status = status;
      },
      end() {
        record.ended = true;
      },
    };
    return {record, span};
  }

  const tracer = {
    startSpan(name: string, options?: {kind?: unknown}): FakeSpan {
      return createSpan(name, options).span;
    },
    startActiveSpan(name: string, optionsOrFn: unknown, maybeFn?: unknown) {
      const isOptionsForm = typeof optionsOrFn !== 'function';
      const options = isOptionsForm ? (optionsOrFn as {kind?: unknown}) : undefined;
      const fn = (isOptionsForm ? maybeFn : optionsOrFn) as (span: FakeSpan) => unknown;

      const {record, span} = createSpan(name, options);
      const previousActive = activeSpan;
      activeSpan = record;
      try {
        return fn(span);
      } finally {
        activeSpan = previousActive;
      }
    },
  };

  return {tracer: tracer as unknown as Tracer, spans};
}
