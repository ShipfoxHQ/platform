import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {
  AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES,
  AGENT_ACCESS_TEXT_MAX_BYTES,
} from './paged-tools.js';

export const AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES = 16 * 1024;
export const AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS = 50;
export const AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS = 20;
export const AGENT_ACCESS_FACET_MAX_ITEMS = 50;
export const AGENT_ACCESS_FACET_VALUE_MAX_BYTES = 256;

const idSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime();
const utf8Encoder = new TextEncoder();

const utf8CappedString = (maxBytes: number) =>
  z
    .string()
    .max(maxBytes)
    .refine((value) => utf8Encoder.encode(value).byteLength <= maxBytes, {
      message: `String must contain at most ${maxBytes} UTF-8 bytes`,
    });

const textSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES);
const shortTextSchema = utf8CappedString(AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES);
const serializedJsonSchema = utf8CappedString(AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES).refine(
  isSerializedJson,
  {message: 'String must contain valid serialized JSON'},
);

export const getTriggerEventInputSchema = z.object({event_id: idSchema}).strict();

export const getTriggerEventFacetsInputSchema = z.object({}).strict();

export type GetTriggerEventInputDto = z.infer<typeof getTriggerEventInputSchema>;
export type GetTriggerEventFacetsInputDto = z.infer<typeof getTriggerEventFacetsInputSchema>;

const triggerOriginSchema = z.enum(['integration', 'manual', 'cron', 'dev']);
const triggerOutcomeSchema = z.enum(['received', 'routed', 'discarded', 'failed', 'errored']);
const triggerDecisionOutcomeSchema = z.enum(['triggered', 'filter-error', 'dispatch-error']);
const triggerDecisionSchema = z
  .object({
    id: idSchema,
    subscription_kind: z.enum(['trigger', 'listener', 'dev']),
    outcome: triggerDecisionOutcomeSchema,
    reason: textSchema.nullable(),
    workflow_definition_id: idSchema.nullable(),
    project_id: idSchema.nullable(),
    workflow_run_id: idSchema.nullable(),
    job_id: idSchema.nullable(),
  })
  .strict();

const triggerReplaySchema = z
  .object({
    id: idSchema,
    workflow_run_id: idSchema.nullable(),
    created_at: dateTimeSchema,
  })
  .strict();

export const getTriggerEventResultSchema = z
  .object({
    id: idSchema,
    origin: triggerOriginSchema,
    provider: textSchema.nullable(),
    source: textSchema,
    event: textSchema,
    outcome: triggerOutcomeSchema,
    matched_count: z.number().int().nonnegative(),
    connection_id: idSchema.nullable(),
    connection_name: shortTextSchema.nullable(),
    replay_of_event_id: idSchema.nullable(),
    received_at: dateTimeSchema,
    processed_at: dateTimeSchema.nullable(),
    payload_preview: serializedJsonSchema,
    payload_preview_truncated: z.literal(true).optional(),
    payload_preview_total_bytes: z.number().int().nonnegative().optional(),
    decisions: z.array(triggerDecisionSchema).max(AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS),
    decisions_truncated: z.literal(true).optional(),
    decisions_total_count: z.number().int().nonnegative(),
    replays: z.array(triggerReplaySchema).max(AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS),
    replays_truncated: z.literal(true).optional(),
    replays_total_count: z.number().int().nonnegative(),
  })
  .strict();

const facetSchema = z
  .object({
    value: utf8CappedString(AGENT_ACCESS_FACET_VALUE_MAX_BYTES),
    count: z.number().int().nonnegative(),
  })
  .strict();

export const getTriggerEventFacetsResultSchema = z
  .object({
    sources: z.array(facetSchema).max(AGENT_ACCESS_FACET_MAX_ITEMS),
    events: z.array(facetSchema).max(AGENT_ACCESS_FACET_MAX_ITEMS),
    origins: z.array(facetSchema).max(AGENT_ACCESS_FACET_MAX_ITEMS),
  })
  .strict();

export type GetTriggerEventResultDto = z.infer<typeof getTriggerEventResultSchema>;
export type GetTriggerEventFacetsResultDto = z.infer<typeof getTriggerEventFacetsResultSchema>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const text = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const shortText = {
  type: 'string',
  maxLength: AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES,
} as const;
const serializedJson = {
  type: 'string',
  maxLength: AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
  contentMediaType: 'application/json',
} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;

export const getTriggerEventInputJsonSchema = {
  type: 'object',
  properties: {event_id: uuid},
  required: ['event_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

function isSerializedJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export const getTriggerEventFacetsInputJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const triggerDecisionJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    subscription_kind: {type: 'string', enum: ['trigger', 'listener', 'dev']},
    outcome: {type: 'string', enum: ['triggered', 'filter-error', 'dispatch-error']},
    reason: nullable(text),
    workflow_definition_id: nullable(uuid),
    project_id: nullable(uuid),
    workflow_run_id: nullable(uuid),
    job_id: nullable(uuid),
  },
  required: [
    'id',
    'subscription_kind',
    'outcome',
    'reason',
    'workflow_definition_id',
    'project_id',
    'workflow_run_id',
    'job_id',
  ],
  additionalProperties: false,
} as const;

const triggerReplayJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    workflow_run_id: nullable(uuid),
    created_at: dateTime,
  },
  required: ['id', 'workflow_run_id', 'created_at'],
  additionalProperties: false,
} as const;

export const getTriggerEventResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    origin: {type: 'string', enum: ['integration', 'manual', 'cron', 'dev']},
    provider: nullable(text),
    source: text,
    event: text,
    outcome: {type: 'string', enum: ['received', 'routed', 'discarded', 'failed', 'errored']},
    matched_count: {type: 'integer', minimum: 0},
    connection_id: nullable(uuid),
    connection_name: nullable(shortText),
    replay_of_event_id: nullable(uuid),
    received_at: dateTime,
    processed_at: nullable(dateTime),
    payload_preview: serializedJson,
    payload_preview_truncated: {const: true},
    payload_preview_total_bytes: {type: 'integer', minimum: 0},
    decisions: {
      type: 'array',
      maxItems: AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS,
      items: triggerDecisionJsonSchema,
    },
    decisions_truncated: {const: true},
    decisions_total_count: {type: 'integer', minimum: 0},
    replays: {
      type: 'array',
      maxItems: AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS,
      items: triggerReplayJsonSchema,
    },
    replays_truncated: {const: true},
    replays_total_count: {type: 'integer', minimum: 0},
  },
  required: [
    'id',
    'origin',
    'provider',
    'source',
    'event',
    'outcome',
    'matched_count',
    'connection_id',
    'connection_name',
    'replay_of_event_id',
    'received_at',
    'processed_at',
    'payload_preview',
    'decisions',
    'decisions_total_count',
    'replays',
    'replays_total_count',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const facetJsonSchema = {
  type: 'object',
  properties: {
    value: {type: 'string', maxLength: AGENT_ACCESS_FACET_VALUE_MAX_BYTES},
    count: {type: 'integer', minimum: 0},
  },
  required: ['value', 'count'],
  additionalProperties: false,
} as const;

export const getTriggerEventFacetsResultJsonSchema = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: facetJsonSchema,
    },
    events: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: facetJsonSchema,
    },
    origins: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: facetJsonSchema,
    },
  },
  required: ['sources', 'events', 'origins'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
