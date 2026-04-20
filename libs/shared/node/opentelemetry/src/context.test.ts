import type {Span} from '@opentelemetry/api';
import {context as otelContext, propagation, ROOT_CONTEXT} from '@opentelemetry/api';
import {contextWithMetadata, enrichSpanWithMetadata, getContextMetadata} from './context.js';

describe('contextWithMetadata', () => {
  it('sets custom context keys and baggage entries', () => {
    const ctx = contextWithMetadata({orgId: 'org-123', userId: 'user-456'});

    const baggage = propagation.getBaggage(ctx);

    expect(baggage?.getEntry('orgId')?.value).toBe('org-123');
    expect(baggage?.getEntry('userId')?.value).toBe('user-456');
  });

  it('preserves existing context and baggage', () => {
    const existingBaggage = propagation.createBaggage({existing: {value: 'val'}});
    const parentCtx = propagation.setBaggage(otelContext.active(), existingBaggage);

    const ctx = contextWithMetadata({orgId: 'org-123'}, {parentContext: parentCtx});

    const baggage = propagation.getBaggage(ctx);
    expect(baggage?.getEntry('existing')?.value).toBe('val');
    expect(baggage?.getEntry('orgId')?.value).toBe('org-123');
  });
});

describe('getContextMetadata', () => {
  it('reads from custom context keys (round-trip via contextWithMetadata)', () => {
    const ctx = contextWithMetadata({orgId: 'org-123', userId: 'user-456'});

    const metadata = getContextMetadata(ctx);

    expect(metadata).toEqual({orgId: 'org-123', userId: 'user-456'});
  });

  it('falls back to baggage when custom keys are absent', () => {
    const existingBaggage = propagation.createBaggage({
      orgId: {value: 'org-123'},
      userId: {value: 'user-456'},
    });
    const ctx = propagation.setBaggage(otelContext.active(), existingBaggage);

    const metadata = getContextMetadata(ctx);

    expect(metadata).toEqual({orgId: 'org-123', userId: 'user-456'});
  });

  it('returns empty object for ROOT_CONTEXT', () => {
    const metadata = getContextMetadata(ROOT_CONTEXT);

    expect(metadata).toEqual({});
  });
});

describe('enrichSpanWithMetadata', () => {
  it('sets span attributes from metadata', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;

    enrichSpanWithMetadata({orgId: 'org-123'}, {span});

    expect(setAttribute).toHaveBeenCalledWith('orgId', 'org-123');
  });

  it('reads from active context when no metadata provided', () => {
    const setAttribute = vi.fn();
    const span = {setAttribute} as unknown as Span;
    const baggage = propagation.createBaggage({orgId: {value: 'org-123'}});
    vi.spyOn(propagation, 'getBaggage').mockReturnValue(baggage);

    enrichSpanWithMetadata(undefined, {span});

    expect(setAttribute).toHaveBeenCalledWith('orgId', 'org-123');
    vi.restoreAllMocks();
  });

  it('is a no-op when no span is provided and none is active', () => {
    expect(() => enrichSpanWithMetadata({orgId: 'org-123'})).not.toThrow();
  });
});
