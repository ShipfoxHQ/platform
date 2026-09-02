import {agentAccessError, agentAccessSuccess} from './envelope.js';
import {
  reduceAgentAccessDetailResponse,
  reducePagedAgentAccessResponse,
  serializedAgentAccessEnvelopeByteLength,
  truncateAgentAccessUtf8,
} from './response.js';

describe('agent-access response bounds', () => {
  test('truncates on a complete UTF-8 code-point boundary', () => {
    const result = truncateAgentAccessUtf8('🙂'.repeat(4), 7);

    expect(result).toEqual({value: '🙂', truncated: true, totalBytes: 16});
  });

  test('regenerates a page cursor from the last retained item', () => {
    const items = Array.from({length: 20}, (_, index) => ({
      id: `item-${index}-${'x'.repeat(20)}`,
    }));
    const envelope = agentAccessSuccess({items, next_cursor: 'producer-cursor'});
    const initialBytes = serializedAgentAccessEnvelopeByteLength(envelope);
    const reduced = reducePagedAgentAccessResponse({
      envelope,
      itemKey: 'items',
      items,
      cursorForItem: (item) => `cursor:${String(item.id)}`,
      maxBytes: initialBytes - 20,
    });
    if (!reduced.ok) throw new Error('Expected a reduced page');
    const result = reduced.result as {items: Array<{id: string}>; next_cursor: string | null};
    const last = result.items.at(-1);

    expect(reduced).toMatchObject({
      response_truncated: true,
      response_total_bytes: initialBytes,
    });
    expect(result.items.length).toBeLessThan(items.length);
    expect(last).toBeDefined();
    expect(result.next_cursor).toBe(`cursor:${last?.id}`);
    expect(serializedAgentAccessEnvelopeByteLength(reduced)).toBeLessThanOrEqual(initialBytes - 20);
  });

  test('returns a content-too-large error instead of dropping every item', () => {
    const envelope = agentAccessSuccess({
      items: [{id: 'x'.repeat(1_000)}],
      next_cursor: null,
    });
    const initialBytes = serializedAgentAccessEnvelopeByteLength(envelope);
    const emptyTruncatedEnvelope = {
      ...envelope,
      result: {items: [], next_cursor: null},
      response_truncated: true,
      response_total_bytes: initialBytes,
    };

    expect(
      reducePagedAgentAccessResponse({
        envelope,
        itemKey: 'items',
        items: [{id: 'x'.repeat(1_000)}],
        cursorForItem: () => 'cursor',
        maxBytes: serializedAgentAccessEnvelopeByteLength(emptyTruncatedEnvelope),
      }),
    ).toEqual({ok: false, error: {code: 'content-too-large'}});
  });

  test('preserves a bounded error envelope when it already fits', () => {
    const envelope = agentAccessError('not-found');

    expect(
      reduceAgentAccessDetailResponse({
        envelope,
        strings: [],
        maxBytes: serializedAgentAccessEnvelopeByteLength(envelope),
      }),
    ).toEqual(envelope);
    expect(reduceAgentAccessDetailResponse({envelope, strings: [], maxBytes: 1})).toEqual({
      ok: false,
      error: {code: 'content-too-large'},
    });
  });
});
