import {context as otelContext, propagation, TraceFlags, trace} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import {contextWithMetadata} from './context.js';
import {extractContextFromAttributes, injectContextToAttributes} from './propagation.js';

beforeAll(() => {
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
});

afterAll(() => {
  propagation.disable();
});

describe('injectContextToAttributes', () => {
  it('writes traceparent into attributes', () => {
    const spanContext = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
    const ctx = trace.setSpanContext(otelContext.active(), spanContext);

    const attrs = injectContextToAttributes({}, ctx);

    expect(attrs.traceparent).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });

  it('merges with existing attributes', () => {
    const attrs = injectContextToAttributes({existing: 'value'});

    expect(attrs.existing).toBe('value');
  });

  it('writes baggage into attributes', () => {
    const ctx = contextWithMetadata({orgId: 'org-123'});

    const attrs = injectContextToAttributes({}, ctx);

    expect(attrs.baggage).toContain('orgId=org-123');
  });
});

describe('extractContextFromAttributes', () => {
  it('restores trace context from attributes', () => {
    const spanContext = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };
    const ctx = trace.setSpanContext(otelContext.active(), spanContext);
    const attrs = injectContextToAttributes({}, ctx);

    const extractedCtx = extractContextFromAttributes(attrs);

    const extractedSpanContext = trace.getSpanContext(extractedCtx);
    expect(extractedSpanContext?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(extractedSpanContext?.spanId).toBe('00f067aa0ba902b7');
  });

  it('round-trip inject/extract preserves baggage', () => {
    const ctx = contextWithMetadata({orgId: 'org-123'});
    const attrs = injectContextToAttributes({}, ctx);

    const extractedCtx = extractContextFromAttributes(attrs);

    const baggage = propagation.getBaggage(extractedCtx);
    expect(baggage?.getEntry('orgId')?.value).toBe('org-123');
  });
});
