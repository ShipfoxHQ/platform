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

export interface ListenerEventBatchPacker {
  readonly events: readonly WorkflowExecutionEvent[];
  add(event: WorkflowExecutionEvent): boolean;
  finish(params: {readonly countLimitReached: boolean}): ListenerEventBatch;
}

export function createListenerEventBatchPacker(params?: {
  readonly maxBytes?: number;
}): ListenerEventBatchPacker {
  const selected: WorkflowExecutionEvent[] = [];
  const maxBytes = params?.maxBytes ?? MAX_LISTENER_TRIGGER_EVENTS_BYTES;
  let serializedBytes = Buffer.byteLength('[]', 'utf8');
  let partitionReason: ListenerBatchPartitionReason | undefined;

  return {
    get events() {
      return selected;
    },
    add(event) {
      if (partitionReason !== undefined) return false;

      const serialized = JSON.stringify(event);
      const eventBytes =
        serialized === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(serialized, 'utf8');
      const candidateBytes =
        serializedBytes + eventBytes + (selected.length === 0 ? 0 : Buffer.byteLength(',', 'utf8'));
      if (candidateBytes > maxBytes) {
        partitionReason = 'byte_limit';
        return false;
      }

      selected.push(event);
      serializedBytes = candidateBytes;
      return true;
    },
    finish(finishParams) {
      if (selected.length === 0 && partitionReason === 'byte_limit') {
        return {kind: 'empty', reason: 'byte_limit'};
      }

      const resultPartitionReason =
        partitionReason ?? (finishParams.countLimitReached ? 'count_limit' : undefined);
      return {
        kind: 'selected',
        events: selected,
        ...(resultPartitionReason === undefined ? {} : {partitionReason: resultPartitionReason}),
      };
    },
  };
}

export function packListenerEventBatch(
  events: readonly WorkflowExecutionEvent[],
  params: {readonly countLimitReached: boolean; readonly maxBytes?: number},
): ListenerEventBatch {
  const packer =
    params.maxBytes === undefined
      ? createListenerEventBatchPacker()
      : createListenerEventBatchPacker({maxBytes: params.maxBytes});

  for (const event of events) {
    if (!packer.add(event)) break;
  }

  return packer.finish({countLimitReached: params.countLimitReached});
}

export function serializedListenerEventsByteLength(
  events: readonly WorkflowExecutionEvent[],
): number {
  const serialized = JSON.stringify(events);
  return serialized === undefined
    ? Number.POSITIVE_INFINITY
    : Buffer.byteLength(serialized, 'utf8');
}
