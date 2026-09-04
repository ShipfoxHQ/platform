import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_PAGE_LIMIT_MAX, AGENT_ACCESS_TEXT_MAX_BYTES} from './paged-tools.js';
import {dateTimeSchema, idSchema, utf8CappedString} from './primitives.js';

/** Default page size for one execution's listener-event history. */
export const AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT = 25;

/** Maximum number of execution listener-event summaries in one page. */
export const AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX = AGENT_ACCESS_PAGE_LIMIT_MAX;

/** Maximum serialized UTF-8 size of one untrusted payload preview. */
export const AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES = 16 * 1024;

const textSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES);
const payloadPreviewSchema = utf8CappedString(
  AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
).refine(isSerializedJson, {message: 'Payload preview must be serialized JSON'});

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

const executionTriggerEventSummarySchema = z
  .object({
    event_ref: textSchema,
    delivery_id: textSchema,
    source: textSchema,
    event: textSchema,
    disposition: executionTriggerEventDispositionSchema,
    outcome: executionTriggerEventOutcomeSchema,
    outcome_reason: executionTriggerEventOutcomeReasonSchema,
    received_at: dateTimeSchema,
    stored_payload_bytes: z.number().int().nonnegative(),
    normalized_event_bytes: z.number().int().nonnegative(),
  })
  .strict();

export const listExecutionTriggerEventsInputSchema = z
  .object({
    job_id: idSchema,
    execution_id: idSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX)
      .default(AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export const getExecutionTriggerEventInputSchema = z
  .object({
    job_id: idSchema,
    execution_id: idSchema,
    event_ref: textSchema,
  })
  .strict();

export type ListExecutionTriggerEventsInputDto = z.output<
  typeof listExecutionTriggerEventsInputSchema
>;
export type GetExecutionTriggerEventInputDto = z.output<typeof getExecutionTriggerEventInputSchema>;

export const listExecutionTriggerEventsResultSchema = z
  .object({
    job_id: idSchema,
    execution_id: idSchema,
    trigger_events: z
      .array(executionTriggerEventSummarySchema)
      .max(AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ListExecutionTriggerEventsResultDto = z.infer<
  typeof listExecutionTriggerEventsResultSchema
>;

export const getExecutionTriggerEventResultSchema = executionTriggerEventSummarySchema
  .extend({
    /** Serialized JSON text. It is untrusted data, not a typed workflow value. */
    payload_preview: payloadPreviewSchema.nullable(),
    payload_preview_truncated: z.literal(true).optional(),
    payload_preview_total_bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export type GetExecutionTriggerEventResultDto = z.infer<
  typeof getExecutionTriggerEventResultSchema
>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const text = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const serializedJson = {
  type: 'string',
  maxLength: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
  contentMediaType: 'application/json',
} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;

export const listExecutionTriggerEventsInputJsonSchema = {
  type: 'object',
  properties: {
    job_id: uuid,
    execution_id: uuid,
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX,
      default: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT,
    },
    cursor: {type: 'string', minLength: 1},
  },
  required: ['job_id', 'execution_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getExecutionTriggerEventInputJsonSchema = {
  type: 'object',
  properties: {job_id: uuid, execution_id: uuid, event_ref: text},
  required: ['job_id', 'execution_id', 'event_ref'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const executionTriggerEventSummaryJson = {
  type: 'object',
  properties: {
    event_ref: text,
    delivery_id: text,
    source: text,
    event: text,
    disposition: {type: 'string', enum: ['fire', 'resolve']},
    outcome: {
      type: 'string',
      enum: ['pending', 'consumed', 'honored', 'rejected', 'abandoned'],
    },
    outcome_reason: {
      anyOf: [
        {
          type: 'string',
          enum: ['payload_too_large', 'until', 'timeout', 'max_executions', 'cancelled'],
        },
        {type: 'null'},
      ],
    },
    received_at: dateTime,
    stored_payload_bytes: {type: 'integer', minimum: 0},
    normalized_event_bytes: {type: 'integer', minimum: 0},
  },
  required: [
    'event_ref',
    'delivery_id',
    'source',
    'event',
    'disposition',
    'outcome',
    'outcome_reason',
    'received_at',
    'stored_payload_bytes',
    'normalized_event_bytes',
  ],
  additionalProperties: false,
} as const;

const executionTriggerEventDetailJson = {
  ...executionTriggerEventSummaryJson,
  properties: {
    ...executionTriggerEventSummaryJson.properties,
    payload_preview: nullable(serializedJson),
    payload_preview_truncated: {const: true},
    payload_preview_total_bytes: {type: 'integer', minimum: 0},
  },
  required: [...executionTriggerEventSummaryJson.required, 'payload_preview'],
} as const;

export const listExecutionTriggerEventsResultJsonSchema = {
  type: 'object',
  properties: {
    job_id: uuid,
    execution_id: uuid,
    trigger_events: {
      type: 'array',
      maxItems: AGENT_ACCESS_EXECUTION_TRIGGER_EVENT_PAGE_MAX,
      items: executionTriggerEventSummaryJson,
    },
    next_cursor: nullable({type: 'string', minLength: 1}),
    total: {type: 'integer', minimum: 0},
  },
  required: ['job_id', 'execution_id', 'trigger_events', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getExecutionTriggerEventResultJsonSchema =
  executionTriggerEventDetailJson satisfies AgentAccessObjectSchema;

function isSerializedJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
