import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_PAGE_LIMIT_MAX, AGENT_ACCESS_TEXT_MAX_BYTES} from './paged-tools.js';

export const AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX = 2_147_483_647;
export const AGENT_ACCESS_WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT = 25;
export const AGENT_ACCESS_WORKFLOW_JOB_PAGE_LIMIT = 100;
export const AGENT_ACCESS_WORKFLOW_EXECUTION_PAGE_LIMIT = 25;
export const AGENT_ACCESS_WORKFLOW_STEP_PAGE_LIMIT = 100;
export const AGENT_ACCESS_WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT = 25;
export const AGENT_ACCESS_WORKFLOW_EXECUTION_COUNT_MAX = 100;

const idSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime();
const utf8Encoder = new TextEncoder();
const textSchema = z
  .string()
  .max(AGENT_ACCESS_TEXT_MAX_BYTES)
  .refine((value) => utf8Encoder.encode(value).byteLength <= AGENT_ACCESS_TEXT_MAX_BYTES, {
    message: `String must contain at most ${AGENT_ACCESS_TEXT_MAX_BYTES} UTF-8 bytes`,
  });
const attemptSchema = z.number().int().min(1).max(AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX);
const pageInput = (defaultLimit: number) => ({
  limit: z.number().int().min(1).max(AGENT_ACCESS_PAGE_LIMIT_MAX).default(defaultLimit),
  cursor: z.string().min(1).optional(),
});

export const getWorkflowRunInputSchema = z
  .object({run_id: idSchema, attempt: attemptSchema.optional()})
  .strict();

export const listWorkflowRunAttemptsInputSchema = z
  .object({run_id: idSchema, ...pageInput(AGENT_ACCESS_WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT)})
  .strict();

export const listWorkflowRunJobsInputSchema = z
  .object({
    run_id: idSchema,
    attempt: attemptSchema,
    ...pageInput(AGENT_ACCESS_WORKFLOW_JOB_PAGE_LIMIT),
  })
  .strict();

export const getWorkflowJobInputSchema = z
  .object({job_id: idSchema, execution_id: idSchema.optional()})
  .strict();

export const listWorkflowJobExecutionsInputSchema = z
  .object({job_id: idSchema, ...pageInput(AGENT_ACCESS_WORKFLOW_EXECUTION_PAGE_LIMIT)})
  .strict();

export const listWorkflowExecutionStepsInputSchema = z
  .object({
    job_id: idSchema,
    execution_id: idSchema,
    ...pageInput(AGENT_ACCESS_WORKFLOW_STEP_PAGE_LIMIT),
  })
  .strict();

export const listWorkflowStepAttemptsInputSchema = z
  .object({step_id: idSchema, ...pageInput(AGENT_ACCESS_WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT)})
  .strict();

export type GetWorkflowRunInputDto = z.output<typeof getWorkflowRunInputSchema>;
export type ListWorkflowRunAttemptsInputDto = z.output<typeof listWorkflowRunAttemptsInputSchema>;
export type ListWorkflowRunJobsInputDto = z.output<typeof listWorkflowRunJobsInputSchema>;
export type GetWorkflowJobInputDto = z.output<typeof getWorkflowJobInputSchema>;
export type ListWorkflowJobExecutionsInputDto = z.output<
  typeof listWorkflowJobExecutionsInputSchema
>;
export type ListWorkflowExecutionStepsInputDto = z.output<
  typeof listWorkflowExecutionStepsInputSchema
>;
export type ListWorkflowStepAttemptsInputDto = z.output<typeof listWorkflowStepAttemptsInputSchema>;

const workflowRunStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
const workflowRunOriginSchema = z.enum(['synced', 'dev']);
const workflowRunRerunModeSchema = z.enum(['all', 'failed']);
const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
const jobStatusReasonSchema = z.enum([
  'dependency_not_completed',
  'condition_false',
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
  'user_cancelled',
  'run_cancelled',
  'timed_out',
  'runner_lost',
  'output_too_large',
  'step_failed',
  'unknown',
  'output_invalid',
]);
const jobModeSchema = z.enum(['one_shot', 'listening']);
const listenerStatusSchema = z.enum(['inactive', 'listening', 'resolved']);
const executionStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
const stepStatusSchema = jobStatusSchema;
const stepTypeSchema = z.enum(['setup', 'run', 'agent', 'checkout', 'tool']);
const stepStatusReasonSchema = z.enum([
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
]);
const boundedExecutionCountSchema = z.union([
  z.number().int().nonnegative().max(AGENT_ACCESS_WORKFLOW_EXECUTION_COUNT_MAX),
  z.literal('100+'),
]);

const workflowRunAttemptResultSchema = z
  .object({
    id: idSchema,
    workflow_run_id: idSchema,
    attempt: attemptSchema,
    status: workflowRunStatusSchema,
    created_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    rerun_mode: workflowRunRerunModeSchema.nullable(),
  })
  .strict();

const workflowRunDevSourceSchema = z
  .object({
    ref: textSchema,
    commit: textSchema,
    config_path: textSchema,
    initiated_by_user_id: idSchema,
    replay_of_event_id: idSchema.nullable(),
  })
  .strict();

const workflowRunTriggerReferenceSchema = z
  .object({
    repository: textSchema.nullable(),
    ref: textSchema.nullable(),
    commit: textSchema.nullable(),
    actor: textSchema.nullable(),
  })
  .strict();

const jobExecutionSummarySchema = z
  .object({
    id: idSchema,
    sequence: z.number().int().positive(),
    name: textSchema,
    status: executionStatusSchema,
    display_status: executionStatusSchema,
    status_reason: jobStatusReasonSchema.nullable(),
    status_reason_message: textSchema.nullable(),
    queued_at: dateTimeSchema.nullable(),
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    timed_out_at: dateTimeSchema.nullable(),
    updated_at: dateTimeSchema,
  })
  .strict();

const jobExecutionStatusCountsSchema = z
  .object({
    pending: boundedExecutionCountSchema,
    running: boundedExecutionCountSchema,
    succeeded: boundedExecutionCountSchema,
    failed: boundedExecutionCountSchema,
    cancelled: boundedExecutionCountSchema,
  })
  .strict();

const workflowJobSummarySchema = z
  .object({
    id: idSchema,
    key: textSchema,
    name: textSchema.nullable(),
    position: z.number().int().nonnegative(),
    status: jobStatusSchema,
    status_reason: jobStatusReasonSchema.nullable(),
    mode: jobModeSchema,
    listener_status: listenerStatusSchema,
    carried_over: z.boolean(),
    execution_count: boundedExecutionCountSchema,
    execution_status_counts: jobExecutionStatusCountsSchema,
    default_execution: jobExecutionSummarySchema.nullable(),
  })
  .strict();

const workflowRunJobStatusCountSchema = z
  .object({status: jobStatusSchema, count: z.number().int().positive()})
  .strict();

/** Compact run data used to start traversal; it deliberately has no jobs field. */
export const getWorkflowRunResultSchema = z
  .object({
    id: idSchema,
    project_id: idSchema,
    definition_id: idSchema,
    number: z.number().int().positive(),
    name: textSchema,
    workflow_name: textSchema,
    status: workflowRunStatusSchema,
    origin: workflowRunOriginSchema,
    dev_source: workflowRunDevSourceSchema.nullable(),
    trigger_provider: textSchema.nullable(),
    trigger_source: textSchema,
    trigger_event: textSchema,
    trigger_reference: workflowRunTriggerReferenceSchema.nullable(),
    created_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    attempt: workflowRunAttemptResultSchema,
    job_status_counts: z.array(workflowRunJobStatusCountSchema),
    has_started_job_execution: z.boolean(),
  })
  .strict();

export type GetWorkflowRunResultDto = z.infer<typeof getWorkflowRunResultSchema>;

export const listWorkflowRunAttemptsResultSchema = z
  .object({
    attempts: z.array(workflowRunAttemptResultSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type ListWorkflowRunAttemptsResultDto = z.infer<typeof listWorkflowRunAttemptsResultSchema>;

export const listWorkflowRunJobsResultSchema = z
  .object({
    workflow_run_id: idSchema,
    workflow_run_attempt: attemptSchema,
    jobs: z.array(workflowJobSummarySchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ListWorkflowRunJobsResultDto = z.infer<typeof listWorkflowRunJobsResultSchema>;

const selectedExecutionSummarySchema = jobExecutionSummarySchema
  .extend({has_context: z.boolean()})
  .strict();

export const getWorkflowJobResultSchema = z
  .object({
    workflow_run_id: idSchema,
    workflow_run_attempt: attemptSchema,
    job: workflowJobSummarySchema,
    selected_execution: selectedExecutionSummarySchema.nullable(),
  })
  .strict();

export type GetWorkflowJobResultDto = z.infer<typeof getWorkflowJobResultSchema>;

export const listWorkflowJobExecutionsResultSchema = z
  .object({
    job_id: idSchema,
    executions: z.array(jobExecutionSummarySchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
    total: boundedExecutionCountSchema.optional(),
  })
  .strict();

export type ListWorkflowJobExecutionsResultDto = z.infer<
  typeof listWorkflowJobExecutionsResultSchema
>;

const workflowStepSummarySchema = z
  .object({
    id: idSchema,
    key: textSchema.nullable(),
    name: textSchema,
    type: stepTypeSchema,
    position: z.number().int().nonnegative(),
    status: stepStatusSchema,
    status_reason: stepStatusReasonSchema.nullable(),
    current_attempt: attemptSchema,
  })
  .strict();

export const listWorkflowExecutionStepsResultSchema = z
  .object({
    job_id: idSchema,
    execution_id: idSchema,
    steps: z.array(workflowStepSummarySchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ListWorkflowExecutionStepsResultDto = z.infer<
  typeof listWorkflowExecutionStepsResultSchema
>;

const workflowStepAttemptSummarySchema = z
  .object({
    id: idSchema,
    attempt: attemptSchema,
    execution_order: z.number().int().positive(),
    status: stepStatusSchema,
    exit_code: z.number().int().nullable(),
    started_at: dateTimeSchema,
    finished_at: dateTimeSchema.nullable(),
  })
  .strict();

export const listWorkflowStepAttemptsResultSchema = z
  .object({
    step_id: idSchema,
    attempts: z.array(workflowStepAttemptSummarySchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ListWorkflowStepAttemptsResultDto = z.infer<
  typeof listWorkflowStepAttemptsResultSchema
>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const text = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;
const pageInputJson = (defaultLimit: number) => ({
  limit: {
    type: 'integer',
    minimum: 1,
    maximum: AGENT_ACCESS_PAGE_LIMIT_MAX,
    default: defaultLimit,
  },
  cursor: {type: 'string', minLength: 1},
});

export const getWorkflowRunInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
  },
  required: ['run_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowRunAttemptsInputJsonSchema = {
  type: 'object',
  properties: {run_id: uuid, ...pageInputJson(AGENT_ACCESS_WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT)},
  required: ['run_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowRunJobsInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
    ...pageInputJson(AGENT_ACCESS_WORKFLOW_JOB_PAGE_LIMIT),
  },
  required: ['run_id', 'attempt'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowJobInputJsonSchema = {
  type: 'object',
  properties: {job_id: uuid, execution_id: uuid},
  required: ['job_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowJobExecutionsInputJsonSchema = {
  type: 'object',
  properties: {job_id: uuid, ...pageInputJson(AGENT_ACCESS_WORKFLOW_EXECUTION_PAGE_LIMIT)},
  required: ['job_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowExecutionStepsInputJsonSchema = {
  type: 'object',
  properties: {
    job_id: uuid,
    execution_id: uuid,
    ...pageInputJson(AGENT_ACCESS_WORKFLOW_STEP_PAGE_LIMIT),
  },
  required: ['job_id', 'execution_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowStepAttemptsInputJsonSchema = {
  type: 'object',
  properties: {step_id: uuid, ...pageInputJson(AGENT_ACCESS_WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT)},
  required: ['step_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const workflowRunAttemptJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    workflow_run_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
    status: {type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled']},
    created_at: dateTime,
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    rerun_mode: nullable({type: 'string', enum: ['all', 'failed']}),
  },
  required: [
    'id',
    'workflow_run_id',
    'attempt',
    'status',
    'created_at',
    'started_at',
    'finished_at',
    'rerun_mode',
  ],
  additionalProperties: false,
} as const;

const devSourceJsonSchema = {
  type: 'object',
  properties: {
    ref: text,
    commit: text,
    config_path: text,
    initiated_by_user_id: uuid,
    replay_of_event_id: nullable(uuid),
  },
  required: ['ref', 'commit', 'config_path', 'initiated_by_user_id', 'replay_of_event_id'],
  additionalProperties: false,
} as const;

const triggerReferenceJsonSchema = {
  type: 'object',
  properties: {
    repository: nullable(text),
    ref: nullable(text),
    commit: nullable(text),
    actor: nullable(text),
  },
  required: ['repository', 'ref', 'commit', 'actor'],
  additionalProperties: false,
} as const;

const executionStatusJsonSchema = {
  type: 'string',
  enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
} as const;
const boundedExecutionCountJsonSchema = {
  anyOf: [
    {type: 'integer', minimum: 0, maximum: AGENT_ACCESS_WORKFLOW_EXECUTION_COUNT_MAX},
    {const: '100+'},
  ],
} as const;
const executionSummaryJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    sequence: {type: 'integer', minimum: 1},
    name: text,
    status: executionStatusJsonSchema,
    display_status: executionStatusJsonSchema,
    status_reason: nullable({
      type: 'string',
      enum: [
        'dependency_not_completed',
        'condition_false',
        'default_gate_rejected',
        'condition_rejected',
        'condition_errored',
        'user_cancelled',
        'run_cancelled',
        'timed_out',
        'runner_lost',
        'output_too_large',
        'step_failed',
        'unknown',
        'output_invalid',
      ],
    }),
    status_reason_message: nullable(text),
    queued_at: nullable(dateTime),
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    timed_out_at: nullable(dateTime),
    updated_at: dateTime,
  },
  required: [
    'id',
    'sequence',
    'name',
    'status',
    'display_status',
    'status_reason',
    'status_reason_message',
    'queued_at',
    'started_at',
    'finished_at',
    'timed_out_at',
    'updated_at',
  ],
  additionalProperties: false,
} as const;
const executionCountsJsonSchema = {
  type: 'object',
  properties: {
    pending: boundedExecutionCountJsonSchema,
    running: boundedExecutionCountJsonSchema,
    succeeded: boundedExecutionCountJsonSchema,
    failed: boundedExecutionCountJsonSchema,
    cancelled: boundedExecutionCountJsonSchema,
  },
  required: ['pending', 'running', 'succeeded', 'failed', 'cancelled'],
  additionalProperties: false,
} as const;
const jobStatusJsonSchema = {
  type: 'string',
  enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'],
} as const;
const jobReasonJsonSchema = nullable({
  type: 'string',
  enum: [
    'dependency_not_completed',
    'condition_false',
    'default_gate_rejected',
    'condition_rejected',
    'condition_errored',
    'user_cancelled',
    'run_cancelled',
    'timed_out',
    'runner_lost',
    'output_too_large',
    'step_failed',
    'unknown',
    'output_invalid',
  ],
});
const jobSummaryJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    key: text,
    name: nullable(text),
    position: {type: 'integer', minimum: 0},
    status: jobStatusJsonSchema,
    status_reason: jobReasonJsonSchema,
    mode: {type: 'string', enum: ['one_shot', 'listening']},
    listener_status: {type: 'string', enum: ['inactive', 'listening', 'resolved']},
    carried_over: {type: 'boolean'},
    execution_count: boundedExecutionCountJsonSchema,
    execution_status_counts: executionCountsJsonSchema,
    default_execution: nullable(executionSummaryJsonSchema),
  },
  required: [
    'id',
    'key',
    'name',
    'position',
    'status',
    'status_reason',
    'mode',
    'listener_status',
    'carried_over',
    'execution_count',
    'execution_status_counts',
    'default_execution',
  ],
  additionalProperties: false,
} as const;

export const getWorkflowRunResultJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    project_id: uuid,
    definition_id: uuid,
    number: {type: 'integer', minimum: 1},
    name: text,
    workflow_name: text,
    status: {type: 'string', enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled']},
    origin: {type: 'string', enum: ['synced', 'dev']},
    dev_source: nullable(devSourceJsonSchema),
    trigger_provider: nullable(text),
    trigger_source: text,
    trigger_event: text,
    trigger_reference: nullable(triggerReferenceJsonSchema),
    created_at: dateTime,
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    attempt: workflowRunAttemptJsonSchema,
    job_status_counts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {status: jobStatusJsonSchema, count: {type: 'integer', minimum: 1}},
        required: ['status', 'count'],
        additionalProperties: false,
      },
    },
    has_started_job_execution: {type: 'boolean'},
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
    'trigger_provider',
    'trigger_source',
    'trigger_event',
    'trigger_reference',
    'created_at',
    'started_at',
    'finished_at',
    'attempt',
    'job_status_counts',
    'has_started_job_execution',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const attemptsArrayJsonSchema = {type: 'array', items: workflowRunAttemptJsonSchema} as const;
export const listWorkflowRunAttemptsResultJsonSchema = {
  type: 'object',
  properties: {attempts: attemptsArrayJsonSchema, next_cursor: nullable({type: 'string'})},
  required: ['attempts', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const stepsJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    key: nullable(text),
    name: text,
    type: {type: 'string', enum: ['setup', 'run', 'agent', 'checkout', 'tool']},
    position: {type: 'integer', minimum: 0},
    status: jobStatusJsonSchema,
    status_reason: nullable({
      type: 'string',
      enum: ['default_gate_rejected', 'condition_rejected', 'condition_errored'],
    }),
    current_attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
  },
  required: ['id', 'key', 'name', 'type', 'position', 'status', 'status_reason', 'current_attempt'],
  additionalProperties: false,
} as const;
const stepAttemptsJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
    execution_order: {type: 'integer', minimum: 1},
    status: jobStatusJsonSchema,
    exit_code: nullable({type: 'integer'}),
    started_at: dateTime,
    finished_at: nullable(dateTime),
  },
  required: [
    'id',
    'attempt',
    'execution_order',
    'status',
    'exit_code',
    'started_at',
    'finished_at',
  ],
  additionalProperties: false,
} as const;

export const listWorkflowRunJobsResultJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
    jobs: {type: 'array', items: jobSummaryJsonSchema},
    next_cursor: nullable({type: 'string'}),
    total: {type: 'integer', minimum: 0},
  },
  required: ['workflow_run_id', 'workflow_run_attempt', 'jobs', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const selectedExecutionJsonSchema = {
  ...executionSummaryJsonSchema,
  properties: {...executionSummaryJsonSchema.properties, has_context: {type: 'boolean'}},
  required: [...executionSummaryJsonSchema.required, 'has_context'],
} as const;

export const getWorkflowJobResultJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX},
    job: jobSummaryJsonSchema,
    selected_execution: nullable(selectedExecutionJsonSchema),
  },
  required: ['workflow_run_id', 'workflow_run_attempt', 'job', 'selected_execution'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowJobExecutionsResultJsonSchema = {
  type: 'object',
  properties: {
    job_id: uuid,
    executions: {type: 'array', items: executionSummaryJsonSchema},
    next_cursor: nullable({type: 'string'}),
    total: boundedExecutionCountJsonSchema,
  },
  required: ['job_id', 'executions', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowExecutionStepsResultJsonSchema = {
  type: 'object',
  properties: {
    job_id: uuid,
    execution_id: uuid,
    steps: {type: 'array', items: stepsJsonSchema},
    next_cursor: nullable({type: 'string'}),
    total: {type: 'integer', minimum: 0},
  },
  required: ['job_id', 'execution_id', 'steps', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowStepAttemptsResultJsonSchema = {
  type: 'object',
  properties: {
    step_id: uuid,
    attempts: {type: 'array', items: stepAttemptsJsonSchema},
    next_cursor: nullable({type: 'string'}),
    total: {type: 'integer', minimum: 0},
  },
  required: ['step_id', 'attempts', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
