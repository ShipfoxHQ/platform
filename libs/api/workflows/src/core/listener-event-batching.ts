import {MAX_JSON_OUTPUT_BYTES} from '@shipfox/expression';
import type {WorkflowExecutionEvent} from './entities/job-execution.js';

/** Maximum UTF-8 bytes in the normalized trigger-event array sent to execution. */
export const MAX_LISTENER_TRIGGER_EVENTS_BYTES = MAX_JSON_OUTPUT_BYTES;

export type ListenerBatchPartitionReason = 'byte_limit' | 'count_limit';

export type ListenerEventBatch =
  | {readonly kind: 'empty'; readonly reason: 'byte_limit'}
  | {
      readonly kind: 'selected';
      readonly events: readonly WorkflowExecutionEvent[];
      readonly partitionReason?: ListenerBatchPartitionReason;
    };

export function packListenerEventBatch(
  events: readonly WorkflowExecutionEvent[],
  params: {readonly countLimitReached: boolean; readonly maxBytes?: number},
): ListenerEventBatch {
  const selected: WorkflowExecutionEvent[] = [];
  const maxBytes = params.maxBytes ?? MAX_LISTENER_TRIGGER_EVENTS_BYTES;

  for (const event of events) {
    const candidate = [...selected, event];
    if (serializedListenerEventsByteLength(candidate) > maxBytes) {
      return selected.length === 0
        ? {kind: 'empty', reason: 'byte_limit'}
        : {kind: 'selected', events: selected, partitionReason: 'byte_limit'};
    }
    selected.push(event);
  }

  return {
    kind: 'selected',
    events: selected,
    ...(params.countLimitReached ? {partitionReason: 'count_limit' as const} : {}),
  };
}

export function serializedListenerEventsByteLength(
  events: readonly WorkflowExecutionEvent[],
): number {
  const serialized = JSON.stringify(events);
  return serialized === undefined
    ? Number.POSITIVE_INFINITY
    : Buffer.byteLength(serialized, 'utf8');
}
