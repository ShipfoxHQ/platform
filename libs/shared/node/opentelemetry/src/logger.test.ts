import {type Span, type SpanContext, TraceFlags, trace} from '@opentelemetry/api';
import * as contextModule from './context.js';
import {logger} from './logger.js';

vi.mock('@shipfox/node-log', () => ({
  createLogger: () => ({child: () => ({})}),
}));

vi.mock('./context.js', () => ({
  getContextMetadata: () => ({}),
}));

function activeSpanWithContext(spanContext: SpanContext): Span {
  return {spanContext: () => spanContext} as Span;
}

describe('logger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cached base logger when no context exists', () => {
    const log1 = logger();
    const log2 = logger();

    expect(log1).toBe(log2);
  });

  it('returns child logger with traceId/spanId when span is active', () => {
    const base = logger();

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      activeSpanWithContext({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: TraceFlags.NONE,
      }),
    );

    const child = logger();

    expect(child).not.toBe(base);
  });

  it('returns child logger when business metadata is present', () => {
    const base = logger();

    vi.spyOn(contextModule, 'getContextMetadata').mockReturnValue({orgId: 'org-123'});

    const child = logger();

    expect(child).not.toBe(base);
  });

  it('returns child logger when both trace and metadata are present', () => {
    const base = logger();

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      activeSpanWithContext({
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        spanId: '00f067aa0ba902b7',
        traceFlags: TraceFlags.NONE,
      }),
    );
    vi.spyOn(contextModule, 'getContextMetadata').mockReturnValue({orgId: 'org-123'});

    const child = logger();

    expect(child).not.toBe(base);
  });
});
