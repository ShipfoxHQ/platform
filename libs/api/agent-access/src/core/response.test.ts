import {agentAccessSuccess} from './envelope.js';
import {
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

  test('returns a schema-shaped content-too-large error when no page fits', () => {
    const envelope = agentAccessSuccess({items: [{id: 'one'}], next_cursor: null});

    expect(
      reducePagedAgentAccessResponse({
        envelope,
        itemKey: 'items',
        items: [{id: 'one'}],
        cursorForItem: () => 'cursor',
        maxBytes: 1,
      }),
    ).toEqual({ok: false, error: {code: 'content-too-large'}});
  });
});
