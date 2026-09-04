import {
  WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES,
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
  type WorkflowExecutionTriggerEventDetailDto,
  type WorkflowExecutionTriggerEventSummaryDto,
} from '@shipfox/api-workflows-dto';
import {serializeJsonWithinLimit} from '#core/json-preview.js';
import type {
  WorkflowExecutionTriggerEventDetailRead,
  WorkflowExecutionTriggerEventSummaryRead,
} from '#db/workflow-runs/job-detail.js';

export function toWorkflowExecutionTriggerEventSummaryDto(
  read: WorkflowExecutionTriggerEventSummaryRead,
): WorkflowExecutionTriggerEventSummaryDto {
  return {
    event_ref: read.eventRef,
    delivery_id: read.deliveryId,
    source: capUtf8(read.source, WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES),
    event: capUtf8(read.event, WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES),
    disposition: read.disposition,
    outcome: read.outcome,
    outcome_reason: read.outcomeReason,
    received_at: read.receivedAt.toISOString(),
    stored_payload_bytes: read.storedPayloadBytes,
    normalized_event_bytes: read.normalizedEventBytes,
  };
}

export function toWorkflowExecutionTriggerEventDetailDto(
  read: WorkflowExecutionTriggerEventDetailRead,
): WorkflowExecutionTriggerEventDetailDto {
  const summary = toWorkflowExecutionTriggerEventSummaryDto(read);
  if (read.payload === null) {
    return {
      ...summary,
      payload_preview: null,
      ...(read.payloadPreviewTruncated ||
      read.storedPayloadBytes > WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES
        ? {
            payload_preview_truncated: true,
            payload_preview_total_bytes: read.storedPayloadBytes,
          }
        : {}),
    };
  }

  const preview = serializeJsonWithinLimit(
    read.payload,
    WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
  );
  return {
    ...summary,
    payload_preview: preview.value,
    ...(preview.truncated
      ? {
          payload_preview_truncated: true,
          payload_preview_total_bytes: Math.max(read.storedPayloadBytes, preview.totalBytes),
        }
      : {}),
  };
}

function capUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;

  let result = '';
  let bytes = 0;
  for (const codePoint of value) {
    const codePointBytes = encoder.encode(codePoint).byteLength;
    if (bytes + codePointBytes > maxBytes) break;
    result += codePoint;
    bytes += codePointBytes;
  }
  return result;
}
