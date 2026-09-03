import type {WorkflowExecutionEvent} from './entities/job-execution.js';
import {
  packListenerEventBatch,
  serializedListenerEventsByteLength,
} from './listener-event-batching.js';

function event(data: unknown): WorkflowExecutionEvent {
  return {
    source: 'github',
    event: 'push',
    delivery_id: 'delivery-1',
    received_at: '2026-01-01T00:00:00.000Z',
    project: null,
    repository: null,
    ref: null,
    commit: null,
    data,
  };
}

describe('packListenerEventBatch', () => {
  test('returns the largest ordered prefix that fits the byte limit', () => {
    const first = event({value: 'first'});
    const second = event({value: 'second'});
    const maxBytes = serializedListenerEventsByteLength([first]);

    const result = packListenerEventBatch([first, second], {
      countLimitReached: false,
      maxBytes,
    });

    expect(result).toEqual({kind: 'selected', events: [first], partitionReason: 'byte_limit'});
  });

  test('reports a count partition when all count-limited rows fit', () => {
    const result = packListenerEventBatch([event('first'), event('second')], {
      countLimitReached: true,
    });

    expect(result).toMatchObject({kind: 'selected', partitionReason: 'count_limit'});
  });

  test('returns empty when the first event cannot fit', () => {
    const first = event('first');

    const result = packListenerEventBatch([first], {
      countLimitReached: false,
      maxBytes: serializedListenerEventsByteLength([]),
    });

    expect(result).toEqual({kind: 'empty', reason: 'byte_limit'});
  });
});
