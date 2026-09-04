import {
  WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES,
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
  workflowExecutionTriggerEventDetailSchema,
} from '@shipfox/api-workflows-dto';
import type {WorkflowExecutionTriggerEventDetailRead} from '#db/workflow-runs/job-detail.js';
import {
  toWorkflowExecutionTriggerEventDetailDto,
  toWorkflowExecutionTriggerEventSummaryDto,
} from './workflow-execution-events.js';

function readEvent(
  overrides: Partial<WorkflowExecutionTriggerEventDetailRead> = {},
): WorkflowExecutionTriggerEventDetailRead {
  return {
    id: crypto.randomUUID(),
    eventRef: 'event-1',
    deliveryId: 'delivery-1',
    source: 'github',
    event: 'push',
    disposition: 'fire',
    outcome: 'consumed',
    outcomeReason: null,
    receivedAt: new Date('2026-08-31T12:00:00.000Z'),
    storedPayloadBytes: 25,
    normalizedEventBytes: 100,
    payloadPreviewTruncated: false,
    payload: {action: 'opened'},
    ...overrides,
  };
}

describe('workflow execution event DTOs', () => {
  it('maps list metadata without exposing the internal row id or payload', () => {
    const summary = toWorkflowExecutionTriggerEventSummaryDto(readEvent());

    expect(summary).toEqual({
      event_ref: 'event-1',
      delivery_id: 'delivery-1',
      source: 'github',
      event: 'push',
      disposition: 'fire',
      outcome: 'consumed',
      outcome_reason: null,
      received_at: '2026-08-31T12:00:00.000Z',
      stored_payload_bytes: 25,
      normalized_event_bytes: 100,
    });
    expect(summary).not.toHaveProperty('id');
    expect(summary).not.toHaveProperty('payload');
  });

  it('caps untrusted source and event labels by UTF-8 byte length', () => {
    const summary = toWorkflowExecutionTriggerEventSummaryDto(
      readEvent({source: 'é'.repeat(400), event: '😀'.repeat(400)}),
    );

    expect(new TextEncoder().encode(summary.source).byteLength).toBeLessThanOrEqual(
      WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES,
    );
    expect(new TextEncoder().encode(summary.event).byteLength).toBeLessThanOrEqual(
      WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES,
    );
    expect(workflowExecutionTriggerEventDetailSchema.shape.source.parse(summary.source)).toBe(
      summary.source,
    );
    expect(workflowExecutionTriggerEventDetailSchema.shape.event.parse(summary.event)).toBe(
      summary.event,
    );
  });

  it('returns valid serialized JSON detail previews within the UTF-8 byte cap', () => {
    const result = toWorkflowExecutionTriggerEventDetailDto(
      readEvent({payload: {message: 'é'.repeat(20)}}),
    );

    expect(result.payload_preview).toBe('{"message":"éééééééééééééééééééé"}');
    expect(result).not.toHaveProperty('payload_preview_truncated');
    expect(new TextEncoder().encode(result.payload_preview ?? '').byteLength).toBeLessThanOrEqual(
      WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
    );
    expect(() => JSON.parse(result.payload_preview ?? '')).not.toThrow();
    expect(workflowExecutionTriggerEventDetailSchema.parse(result)).toEqual(result);
  });

  it('marks an unavailable oversized payload preview without hydrating its payload', () => {
    const storedPayloadBytes = WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES + 1;
    const result = toWorkflowExecutionTriggerEventDetailDto(
      readEvent({payload: null, storedPayloadBytes}),
    );

    expect(result).toMatchObject({
      payload_preview: null,
      payload_preview_truncated: true,
      payload_preview_total_bytes: storedPayloadBytes,
    });
    expect(workflowExecutionTriggerEventDetailSchema.parse(result)).toEqual(result);
  });

  it('truncates large hydrated JSON values at a valid JSON boundary', () => {
    const result = toWorkflowExecutionTriggerEventDetailDto(
      readEvent({payload: {body: 'x'.repeat(WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES)}}),
    );

    expect(result.payload_preview_truncated).toBe(true);
    expect(result.payload_preview_total_bytes).toBeGreaterThan(
      WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
    );
    expect(new TextEncoder().encode(result.payload_preview ?? '').byteLength).toBeLessThanOrEqual(
      WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
    );
    expect(() => JSON.parse(result.payload_preview ?? '')).not.toThrow();
  });

  it('keeps deeply nested JSON detail reads valid when recursive measurement overflows', () => {
    let payload: unknown = {value: 'ok'};
    for (let index = 0; index < 3_000; index += 1) payload = [payload];

    const result = toWorkflowExecutionTriggerEventDetailDto(readEvent({payload}));

    expect(result.payload_preview).toBe(JSON.stringify(payload));
    expect(result).not.toHaveProperty('payload_preview_truncated');
    expect(workflowExecutionTriggerEventDetailSchema.parse(result)).toEqual(result);
  });
});
