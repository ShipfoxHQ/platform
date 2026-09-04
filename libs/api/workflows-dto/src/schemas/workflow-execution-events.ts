import {z} from 'zod';

/** Default and maximum page sizes for one execution's listener-event history. */
export const WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT = 25;
export const WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_MAX = 100;

/** Maximum serialized UTF-8 size of one untrusted payload preview. */
export const WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES = 16 * 1024;

/** Maximum UTF-8 size of untrusted source and event labels in one read. */
export const WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES = 512;

const executionTriggerEventDispositionSchema = z.enum(['fire', 'resolve']);
const executionTriggerEventOutcomeSchema = z.enum([
  'pending',
  'consumed',
  'honored',
  'rejected',
  'abandoned',
]);
const executionTriggerEventOutcomeReasonSchema = z
  .enum(['payload_too_large', 'until', 'timeout', 'max_executions', 'cancelled'])
  .nullable();
const executionTriggerEventMetadataSchema = z
  .string()
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
      WORKFLOW_EXECUTION_TRIGGER_EVENT_METADATA_MAX_BYTES,
    {message: 'Execution trigger event metadata exceeds its UTF-8 byte limit'},
  );

export const workflowExecutionTriggerEventSummarySchema = z.object({
  event_ref: z.string().min(1),
  delivery_id: z.string().min(1),
  source: executionTriggerEventMetadataSchema,
  event: executionTriggerEventMetadataSchema,
  disposition: executionTriggerEventDispositionSchema,
  outcome: executionTriggerEventOutcomeSchema,
  outcome_reason: executionTriggerEventOutcomeReasonSchema,
  received_at: z.string().datetime(),
  stored_payload_bytes: z.number().int().nonnegative(),
  normalized_event_bytes: z.number().int().nonnegative(),
});

export type WorkflowExecutionTriggerEventSummaryDto = z.infer<
  typeof workflowExecutionTriggerEventSummarySchema
>;

const payloadPreviewSchema = z
  .string()
  .refine(
    (value) =>
      new TextEncoder().encode(value).byteLength <=
      WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
    {message: 'Payload preview exceeds its UTF-8 byte limit'},
  )
  .refine(
    (value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    {message: 'Payload preview must be serialized JSON'},
  );

export const workflowExecutionTriggerEventDetailSchema =
  workflowExecutionTriggerEventSummarySchema.extend({
    /** Serialized JSON text. It is untrusted data, not a workflow value. */
    payload_preview: payloadPreviewSchema.nullable(),
    payload_preview_truncated: z.literal(true).optional(),
    payload_preview_total_bytes: z.number().int().nonnegative().optional(),
  });

export type WorkflowExecutionTriggerEventDetailDto = z.infer<
  typeof workflowExecutionTriggerEventDetailSchema
>;

export const workflowExecutionTriggerEventsResponseSchema = z.object({
  items: z
    .array(workflowExecutionTriggerEventSummarySchema)
    .max(WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_MAX),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

export type WorkflowExecutionTriggerEventsResponseDto = z.infer<
  typeof workflowExecutionTriggerEventsResponseSchema
>;
