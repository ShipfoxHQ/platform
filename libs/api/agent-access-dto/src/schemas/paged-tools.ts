import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {dateTimeSchema, idSchema, utf8CappedString} from './primitives.js';

export const AGENT_ACCESS_DEFAULT_PAGE_LIMIT = 50;
export const AGENT_ACCESS_PAGE_LIMIT_MAX = 100;
export const AGENT_ACCESS_RESPONSE_MAX_BYTES = 128 * 1024;
export const AGENT_ACCESS_TEXT_MAX_BYTES = 512;
export const AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES = 256;
export const AGENT_ACCESS_DIAGNOSTIC_CODE_MAX_BYTES = 128;
export const AGENT_ACCESS_DIAGNOSTIC_MESSAGE_MAX_BYTES = 512;
export const AGENT_ACCESS_DIAGNOSTIC_PATH_MAX_BYTES = 512;
export const AGENT_ACCESS_DIAGNOSTIC_MAX_ITEMS = 10;
export const AGENT_ACCESS_ANNOTATION_BODY_MAX_BYTES = 8 * 1024;

const pageInputFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(AGENT_ACCESS_PAGE_LIMIT_MAX)
    .default(AGENT_ACCESS_DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).optional(),
};
const cappedInputTextSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES);

export const listProjectsInputSchema = z.object(pageInputFields).strict();

export const listWorkflowDefinitionsInputSchema = z
  .object({
    project_id: idSchema,
    ...pageInputFields,
  })
  .strict();

const workflowRunStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
const workflowRunOriginSchema = z.enum(['synced', 'dev']);
const AGENT_ACCESS_ATTEMPT_MAX = 2_147_483_647;
const WORKFLOW_RUN_DATE_WINDOW_MAX_MS = 365 * 24 * 60 * 60 * 1000;

export const listWorkflowRunsInputSchema = z
  .object({
    project_id: idSchema,
    status: workflowRunStatusSchema.optional(),
    definition_id: idSchema.optional(),
    origin: workflowRunOriginSchema.optional(),
    trigger_source: cappedInputTextSchema.optional(),
    created_from: dateTimeSchema.optional(),
    created_to: dateTimeSchema.optional(),
    ...pageInputFields,
  })
  .superRefine((value, context) => {
    if (
      value.created_from !== undefined &&
      value.created_to !== undefined &&
      new Date(value.created_from) > new Date(value.created_to)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['created_from'],
        message: 'created_from must be before or equal to created_to',
      });
    } else if (
      value.created_from !== undefined &&
      value.created_to !== undefined &&
      new Date(value.created_to).getTime() - new Date(value.created_from).getTime() >
        WORKFLOW_RUN_DATE_WINDOW_MAX_MS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['created_to'],
        message: 'created date window must be 365 days or less',
      });
    }
  })
  .strict();

export const getRunAnnotationsInputSchema = z
  .object({
    run_id: idSchema,
    attempt: z.number().int().min(1).max(AGENT_ACCESS_ATTEMPT_MAX).optional(),
    job_execution_id: idSchema.optional(),
    ...pageInputFields,
  })
  .strict();

const triggerEventOriginSchema = z.enum(['integration', 'manual', 'cron', 'dev']);
const triggerEventOutcomeSchema = z.enum(['received', 'routed', 'discarded', 'failed', 'errored']);

export const listTriggerEventsInputSchema = z
  .object({
    source: z.array(cappedInputTextSchema).optional(),
    event: z.array(cappedInputTextSchema).optional(),
    origin: z.array(triggerEventOriginSchema).optional(),
    outcome: z.array(triggerEventOutcomeSchema).optional(),
    replayable: z.literal(true).optional(),
    from: dateTimeSchema.optional(),
    to: dateTimeSchema.optional(),
    ...pageInputFields,
  })
  .superRefine((value, context) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      new Date(value.from) > new Date(value.to)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from must be before or equal to to',
      });
    }
  })
  .strict();

export type ListProjectsInputDto = z.output<typeof listProjectsInputSchema>;
export type ListWorkflowDefinitionsInputDto = z.output<typeof listWorkflowDefinitionsInputSchema>;
export type ListWorkflowRunsInputDto = z.output<typeof listWorkflowRunsInputSchema>;
export type GetRunAnnotationsInputDto = z.output<typeof getRunAnnotationsInputSchema>;
export type ListTriggerEventsInputDto = z.output<typeof listTriggerEventsInputSchema>;

const dateTime = {type: 'string', format: 'date-time'} as const;
const pageInputJsonProperties = {
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
    default: AGENT_ACCESS_DEFAULT_PAGE_LIMIT,
  },
  cursor: {type: 'string', minLength: 1},
} as const;

export const listProjectsInputJsonSchema = {
  type: 'object',
  properties: pageInputJsonProperties,
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowDefinitionsInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: {type: 'string', format: 'uuid'},
    ...pageInputJsonProperties,
  },
  required: ['project_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowRunsInputJsonSchema = {
  type: 'object',
  properties: {
    project_id: {type: 'string', format: 'uuid'},
    status: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
    },
    definition_id: {type: 'string', format: 'uuid'},
    origin: {type: 'string', enum: ['synced', 'dev']},
    trigger_source: {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    created_from: dateTime,
    created_to: dateTime,
    ...pageInputJsonProperties,
  },
  required: ['project_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getRunAnnotationsInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: {type: 'string', format: 'uuid'},
    attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_ATTEMPT_MAX},
    job_execution_id: {type: 'string', format: 'uuid'},
    ...pageInputJsonProperties,
  },
  required: ['run_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listTriggerEventsInputJsonSchema = {
  type: 'object',
  properties: {
    source: {
      type: 'array',
      items: {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    },
    event: {
      type: 'array',
      items: {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES},
    },
    origin: {
      type: 'array',
      items: {type: 'string', enum: ['integration', 'manual', 'cron', 'dev']},
    },
    outcome: {
      type: 'array',
      items: {type: 'string', enum: ['received', 'routed', 'discarded', 'failed', 'errored']},
    },
    replayable: {const: true},
    from: dateTime,
    to: dateTime,
    ...pageInputJsonProperties,
  },
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const projectResultItemSchema = z
  .object({
    id: idSchema,
    name: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    slug: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    created_at: dateTimeSchema,
    updated_at: dateTimeSchema,
  })
  .strict();

export const listProjectsResultSchema = z
  .object({
    projects: z.array(projectResultItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

const definitionDiagnosticSchema = z
  .object({
    severity: z.enum(['error', 'warning']),
    code: utf8CappedString(AGENT_ACCESS_DIAGNOSTIC_CODE_MAX_BYTES),
    message: utf8CappedString(AGENT_ACCESS_DIAGNOSTIC_MESSAGE_MAX_BYTES),
    path: utf8CappedString(AGENT_ACCESS_DIAGNOSTIC_PATH_MAX_BYTES).optional(),
    file_path: utf8CappedString(AGENT_ACCESS_DIAGNOSTIC_PATH_MAX_BYTES).optional(),
  })
  .strict();

const definitionSyncErrorCodes = [
  'no-workflow-files',
  'invalid-definition',
  'provider-repository-not-found',
  'provider-file-not-found',
  'provider-access-denied',
  'provider-rate-limited',
  'provider-timeout',
  'provider-unavailable',
  'provider-malformed-response',
  'content-too-large',
  'too-many-files',
  'connection-unavailable',
  'unknown',
] as const;
const definitionSyncErrorCodeSchema = z.enum(definitionSyncErrorCodes);

const definitionDiagnosticsSummarySchema = z
  .object({
    error_count: z.number().int().nonnegative(),
    warning_count: z.number().int().nonnegative(),
    items: z.array(definitionDiagnosticSchema).max(AGENT_ACCESS_DIAGNOSTIC_MAX_ITEMS),
  })
  .strict();

const definitionSyncSchema = z
  .object({
    ref: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    status: z.enum(['pending', 'syncing', 'succeeded', 'failed']),
    last_sync_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    last_error_code: definitionSyncErrorCodeSchema.nullable(),
    last_error_message: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    diagnostics: definitionDiagnosticsSummarySchema,
  })
  .strict();

const definitionResultItemSchema = z
  .object({
    id: idSchema,
    project_id: idSchema,
    name: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    config_path: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    source: z.enum(['manual', 'vcs']),
    ref: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    sha: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
  })
  .strict();

export const listWorkflowDefinitionsResultSchema = z
  .object({
    definitions: z.array(definitionResultItemSchema),
    sync: definitionSyncSchema.nullable(),
    next_cursor: z.string().nullable(),
  })
  .strict();

const runDevSourceSchema = z
  .object({
    ref: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    commit: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    config_path: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    initiated_by_user_id: idSchema,
    replay_of_event_id: idSchema.nullable(),
  })
  .strict();

const runTriggerReferenceSchema = z
  .object({
    repository: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    ref: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    commit: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    actor: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
  })
  .strict();

const jobStatusCountSchema = z
  .object({
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped']),
    count: z.number().int().positive(),
  })
  .strict();

const runResultItemSchema = z
  .object({
    id: idSchema,
    project_id: idSchema,
    definition_id: idSchema,
    number: z.number().int().positive(),
    name: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    workflow_name: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']),
    origin: z.enum(['synced', 'dev']),
    dev_source: runDevSourceSchema.nullable(),
    current_attempt: z.number().int().positive(),
    latest_attempt: z.number().int().positive(),
    trigger_provider: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    trigger_source: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    trigger_event: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    trigger_reference: runTriggerReferenceSchema.nullable(),
    job_status_counts: z.array(jobStatusCountSchema),
    has_started_job_execution: z.boolean(),
    created_at: dateTimeSchema,
    updated_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
  })
  .strict();

export const listWorkflowRunsResultSchema = z
  .object({
    runs: z.array(runResultItemSchema),
    next_cursor: z.string().nullable(),
    filtered_total_count: z.number().int().nonnegative().nullable(),
  })
  .strict();

const annotationResultItemSchema = z
  .object({
    id: idSchema,
    origin_step_id: idSchema,
    origin_step_attempt: z.number().int().min(1),
    job_execution_id: idSchema,
    sequence: z.number().int().min(1),
    created_at: dateTimeSchema,
    body: utf8CappedString(AGENT_ACCESS_ANNOTATION_BODY_MAX_BYTES),
    body_truncated: z.literal(true).optional(),
    body_total_bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const getRunAnnotationsResultSchema = z
  .object({
    annotations: z.array(annotationResultItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

const triggerEventResultItemSchema = z
  .object({
    id: idSchema,
    origin: z.enum(['integration', 'manual', 'cron', 'dev']),
    provider: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES).nullable(),
    source: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    event: utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES),
    outcome: z.enum(['received', 'routed', 'discarded', 'failed', 'errored']),
    matched_count: z.number().int().nonnegative(),
    connection_id: idSchema.nullable(),
    connection_name: utf8CappedString(AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES).nullable(),
    replay_of_event_id: idSchema.nullable(),
    received_at: dateTimeSchema,
    processed_at: dateTimeSchema.nullable(),
  })
  .strict();

export const listTriggerEventsResultSchema = z
  .object({
    trigger_events: z.array(triggerEventResultItemSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type ListProjectsResultDto = z.infer<typeof listProjectsResultSchema>;
export type ListWorkflowDefinitionsResultDto = z.infer<typeof listWorkflowDefinitionsResultSchema>;
export type ListWorkflowRunsResultDto = z.infer<typeof listWorkflowRunsResultSchema>;
export type GetRunAnnotationsResultDto = z.infer<typeof getRunAnnotationsResultSchema>;
export type ListTriggerEventsResultDto = z.infer<typeof listTriggerEventsResultSchema>;

const uuid = {type: 'string', format: 'uuid'} as const;
const cappedText = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const diagnostic = {
  type: 'object',
  properties: {
    severity: {type: 'string', enum: ['error', 'warning']},
    code: {type: 'string', maxLength: AGENT_ACCESS_DIAGNOSTIC_CODE_MAX_BYTES},
    message: {type: 'string', maxLength: AGENT_ACCESS_DIAGNOSTIC_MESSAGE_MAX_BYTES},
    path: {type: 'string', maxLength: AGENT_ACCESS_DIAGNOSTIC_PATH_MAX_BYTES},
    file_path: {type: 'string', maxLength: AGENT_ACCESS_DIAGNOSTIC_PATH_MAX_BYTES},
  },
  required: ['severity', 'code', 'message'],
  additionalProperties: false,
} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;

const projectResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    name: cappedText,
    slug: cappedText,
    created_at: dateTime,
    updated_at: dateTime,
  },
  required: ['id', 'name', 'slug', 'created_at', 'updated_at'],
  additionalProperties: false,
} as const;

export const listProjectsResultJsonSchema = {
  type: 'object',
  properties: {
    projects: {type: 'array', items: projectResultJsonSchema},
    next_cursor: nullable({type: 'string'}),
  },
  required: ['projects', 'next_cursor'],
  additionalProperties: false,
} as const;

const definitionResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    project_id: uuid,
    name: cappedText,
    config_path: nullable(cappedText),
    source: {type: 'string', enum: ['manual', 'vcs']},
    ref: nullable(cappedText),
    sha: nullable(cappedText),
  },
  required: ['id', 'project_id', 'name', 'config_path', 'source', 'ref', 'sha'],
  additionalProperties: false,
} as const;

const definitionSyncJsonSchema = {
  type: 'object',
  properties: {
    ref: nullable(cappedText),
    status: {type: 'string', enum: ['pending', 'syncing', 'succeeded', 'failed']},
    last_sync_at: dateTime,
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    last_error_code: nullable({type: 'string', enum: definitionSyncErrorCodes}),
    last_error_message: nullable(cappedText),
    diagnostics: {
      type: 'object',
      properties: {
        error_count: {type: 'integer', minimum: 0},
        warning_count: {type: 'integer', minimum: 0},
        items: {type: 'array', maxItems: AGENT_ACCESS_DIAGNOSTIC_MAX_ITEMS, items: diagnostic},
      },
      required: ['error_count', 'warning_count', 'items'],
      additionalProperties: false,
    },
  },
  required: [
    'ref',
    'status',
    'last_sync_at',
    'started_at',
    'finished_at',
    'last_error_code',
    'last_error_message',
    'diagnostics',
  ],
  additionalProperties: false,
} as const;

export const listWorkflowDefinitionsResultJsonSchema = {
  type: 'object',
  properties: {
    definitions: {type: 'array', items: definitionResultJsonSchema},
    sync: nullable(definitionSyncJsonSchema),
    next_cursor: nullable({type: 'string'}),
  },
  required: ['definitions', 'sync', 'next_cursor'],
  additionalProperties: false,
} as const;

const runDevSourceJsonSchema = {
  type: 'object',
  properties: {
    ref: cappedText,
    commit: cappedText,
    config_path: cappedText,
    initiated_by_user_id: uuid,
    replay_of_event_id: nullable(uuid),
  },
  required: ['ref', 'commit', 'config_path', 'initiated_by_user_id', 'replay_of_event_id'],
  additionalProperties: false,
} as const;
const runTriggerReferenceJsonSchema = {
  type: 'object',
  properties: {
    repository: nullable(cappedText),
    ref: nullable(cappedText),
    commit: nullable(cappedText),
    actor: nullable(cappedText),
  },
  required: ['repository', 'ref', 'commit', 'actor'],
  additionalProperties: false,
} as const;
const jobStatusCountJsonSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'],
    },
    count: {type: 'integer', minimum: 1},
  },
  required: ['status', 'count'],
  additionalProperties: false,
} as const;
const runResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    project_id: uuid,
    definition_id: uuid,
    number: {type: 'integer', minimum: 1},
    name: cappedText,
    workflow_name: cappedText,
    status: {type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled']},
    origin: {type: 'string', enum: ['synced', 'dev']},
    dev_source: nullable(runDevSourceJsonSchema),
    current_attempt: {type: 'integer', minimum: 1},
    latest_attempt: {type: 'integer', minimum: 1},
    trigger_provider: nullable(cappedText),
    trigger_source: cappedText,
    trigger_event: cappedText,
    trigger_reference: nullable(runTriggerReferenceJsonSchema),
    job_status_counts: {type: 'array', items: jobStatusCountJsonSchema},
    has_started_job_execution: {type: 'boolean'},
    created_at: dateTime,
    updated_at: dateTime,
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
  },
  required: [
    'id',
    'project_id',
    'definition_id',
    'number',
    'name',
    'workflow_name',
    'status',
    'origin',
    'dev_source',
    'current_attempt',
    'latest_attempt',
    'trigger_provider',
    'trigger_source',
    'trigger_event',
    'trigger_reference',
    'job_status_counts',
    'has_started_job_execution',
    'created_at',
    'updated_at',
    'started_at',
    'finished_at',
  ],
  additionalProperties: false,
} as const;

export const listWorkflowRunsResultJsonSchema = {
  type: 'object',
  properties: {
    runs: {type: 'array', items: runResultJsonSchema},
    next_cursor: nullable({type: 'string'}),
    filtered_total_count: nullable({type: 'integer', minimum: 0}),
  },
  required: ['runs', 'next_cursor', 'filtered_total_count'],
  additionalProperties: false,
} as const;

const annotationResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    origin_step_id: uuid,
    origin_step_attempt: {type: 'integer', minimum: 1},
    job_execution_id: uuid,
    sequence: {type: 'integer', minimum: 1},
    created_at: dateTime,
    body: {type: 'string', maxLength: AGENT_ACCESS_ANNOTATION_BODY_MAX_BYTES},
    body_truncated: {const: true},
    body_total_bytes: {type: 'integer', minimum: 0},
  },
  required: [
    'id',
    'origin_step_id',
    'origin_step_attempt',
    'job_execution_id',
    'sequence',
    'created_at',
    'body',
  ],
  additionalProperties: false,
} as const;

export const getRunAnnotationsResultJsonSchema = {
  type: 'object',
  properties: {
    annotations: {type: 'array', items: annotationResultJsonSchema},
    next_cursor: nullable({type: 'string'}),
  },
  required: ['annotations', 'next_cursor'],
  additionalProperties: false,
} as const;

const triggerEventResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    origin: {type: 'string', enum: ['integration', 'manual', 'cron', 'dev']},
    provider: nullable(cappedText),
    source: cappedText,
    event: cappedText,
    outcome: {type: 'string', enum: ['received', 'routed', 'discarded', 'failed', 'errored']},
    matched_count: {type: 'integer', minimum: 0},
    connection_id: nullable(uuid),
    connection_name: nullable({type: 'string', maxLength: AGENT_ACCESS_CONNECTION_NAME_MAX_BYTES}),
    replay_of_event_id: nullable(uuid),
    received_at: dateTime,
    processed_at: nullable(dateTime),
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
  ],
  additionalProperties: false,
} as const;

export const listTriggerEventsResultJsonSchema = {
  type: 'object',
  properties: {
    trigger_events: {type: 'array', items: triggerEventResultJsonSchema},
    next_cursor: nullable({type: 'string'}),
  },
  required: ['trigger_events', 'next_cursor'],
  additionalProperties: false,
} as const;
