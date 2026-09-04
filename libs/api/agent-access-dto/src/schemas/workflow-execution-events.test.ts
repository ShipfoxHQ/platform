import {
  AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT,
  AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX,
  AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
  getExecutionTriggerEventResultJsonSchema,
  getExecutionTriggerEventResultSchema,
  listExecutionTriggerEventsInputSchema,
  listExecutionTriggerEventsResultJsonSchema,
  listExecutionTriggerEventsResultSchema,
} from './workflow-execution-events.js';

const jobId = '00000000-0000-4000-8000-000000000001';
const executionId = '00000000-0000-4000-8000-000000000002';
const eventRef = '00000000-0000-4000-8000-000000000003';
const deliveryId = '00000000-0000-4000-8000-000000000004';
const receivedAt = '2026-08-31T12:00:00.000Z';

describe('workflow execution event Agent Access schemas', () => {
  test('accepts bounded summaries and serialized JSON detail', () => {
    expect(listExecutionTriggerEventsResultSchema.safeParse(listResult()).success).toBe(true);
    expect(
      getExecutionTriggerEventResultSchema.safeParse({
        ...summary(),
        payload_preview: '{"action":"opened"}',
      }).success,
    ).toBe(true);
  });

  test('uses the producer page default and rejects workspace-level input', () => {
    expect(
      listExecutionTriggerEventsInputSchema.parse({job_id: jobId, execution_id: executionId}),
    ).toMatchObject({limit: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT});
    expect(
      listExecutionTriggerEventsInputSchema.safeParse({
        job_id: jobId,
        execution_id: executionId,
        workspace_id: '00000000-0000-4000-8000-000000000005',
      }).success,
    ).toBe(false);
  });

  test('mirrors page, metadata, and preview bounds in JSON schemas', () => {
    expect(listExecutionTriggerEventsResultJsonSchema.properties.trigger_events).toMatchObject({
      type: 'array',
      maxItems: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX,
    });
    expect(getExecutionTriggerEventResultJsonSchema.properties.payload_preview).toMatchObject({
      anyOf: [
        {
          type: 'string',
          maxLength: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
          contentMediaType: 'application/json',
        },
        {type: 'null'},
      ],
    });
  });

  test('rejects clipped or invalid payload previews', () => {
    const invalidPreviews = [
      'not-json',
      `{"body":"${'x'.repeat(AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES)}"}`,
    ];
    for (const payload_preview of invalidPreviews) {
      expect(
        getExecutionTriggerEventResultSchema.safeParse({...summary(), payload_preview}).success,
      ).toBe(false);
    }
  });
});

function summary() {
  return {
    event_ref: eventRef,
    delivery_id: deliveryId,
    source: 'github',
    event: 'push',
    disposition: 'fire' as const,
    outcome: 'consumed' as const,
    outcome_reason: null,
    received_at: receivedAt,
    stored_payload_bytes: 32,
    normalized_event_bytes: 128,
  };
}

function listResult() {
  return {
    job_id: jobId,
    execution_id: executionId,
    trigger_events: [summary()],
    next_cursor: null,
    total: 1,
  };
}
