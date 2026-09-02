import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';

export const AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES = 16 * 1024;
export const AGENT_ACCESS_EVALUATION_TRACE_MAX_ITEMS = 50;
export const AGENT_ACCESS_EVALUATION_TRACE_ROOT_MAX_ITEMS = 10;
export const AGENT_ACCESS_EVALUATION_TRACE_ROOT_MAX_BYTES = 256;
export const AGENT_ACCESS_WORKFLOW_RUN_JOB_MAX_ITEMS = 50;
export const AGENT_ACCESS_WORKFLOW_RUN_JOB_EXECUTION_MAX_ITEMS = 10;
export const AGENT_ACCESS_WORKFLOW_RUN_STEP_MAX_ITEMS = 50;
export const AGENT_ACCESS_WORKFLOW_RUN_STEP_ATTEMPT_MAX_ITEMS = 10;
export const AGENT_ACCESS_RUNNER_LABEL_MAX_ITEMS = 10;
export const AGENT_ACCESS_RUNNER_LABEL_MAX_BYTES = 256;
export const AGENT_ACCESS_DEPENDENCY_MAX_ITEMS = 25;
export const AGENT_ACCESS_DEPENDENCY_MAX_BYTES = 256;
export const AGENT_ACCESS_TRIGGER_DECISION_MAX_ITEMS = 50;
export const AGENT_ACCESS_TRIGGER_REPLAY_MAX_ITEMS = 20;
export const AGENT_ACCESS_FACET_MAX_ITEMS = 50;
export const AGENT_ACCESS_FACET_VALUE_MAX_BYTES = 256;

const AGENT_ACCESS_ATTEMPT_MAX = 2_147_483_647;
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

const textSchema = utf8CappedString(512);
const shortTextSchema = utf8CappedString(256);
const serializedJsonSchema = utf8CappedString(AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES);
const attemptSchema = z.number().int().min(1).max(AGENT_ACCESS_ATTEMPT_MAX);

export const getWorkflowRunInputSchema = z
  .object({
    run_id: idSchema,
    attempt: attemptSchema.optional(),
  })
  .strict();

export const getStepAttemptInputSchema = z
  .object({
    step_id: idSchema,
    attempt: attemptSchema.optional(),
  })
  .strict();

export const getTriggerEventInputSchema = z
  .object({
    event_id: idSchema,
  })
  .strict();

export const getTriggerEventFacetsInputSchema = z.object({}).strict();

export type GetWorkflowRunInputDto = z.infer<typeof getWorkflowRunInputSchema>;
export type GetStepAttemptInputDto = z.infer<typeof getStepAttemptInputSchema>;
export type GetTriggerEventInputDto = z.infer<typeof getTriggerEventInputSchema>;
export type GetTriggerEventFacetsInputDto = z.infer<typeof getTriggerEventFacetsInputSchema>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const text = {type: 'string', maxLength: 512} as const;
const shortText = {type: 'string', maxLength: 256} as const;
const serializedJson = {
  type: 'string',
  maxLength: AGENT_ACCESS_SERIALIZED_JSON_MAX_BYTES,
} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;

const runDevSourceSchema = z
  .object({
    ref: textSchema,
    commit: textSchema,
    config_path: textSchema,
    initiated_by_user_id: idSchema,
    replay_of_event_id: idSchema.nullable(),
  })
  .strict();

const runTriggerReferenceSchema = z
  .object({
    repository: textSchema.nullable(),
    ref: textSchema.nullable(),
    commit: textSchema.nullable(),
    actor: textSchema.nullable(),
  })
  .strict();

const runStatusSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
const runOriginSchema = z.enum(['synced', 'dev']);
const jobStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
const jobModeSchema = z.enum(['one_shot', 'listening']);
const listenerStatusSchema = z.enum(['inactive', 'listening', 'resolved']);
const resolutionReasonSchema = z.enum(['until', 'timeout', 'max_executions', 'cancelled']);
const stepErrorReasonSchema = z.enum([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'checkout_path_invalid',
  'checkout_destination_occupied',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
  'config_unresolvable',
  'output_invalid',
  'agent_config_invalid',
  'agent_invocation_failed',
  'agent_harness_unavailable',
  'agent_session_key_invalid',
  'agent_session_held',
  'agent_session_harness_mismatch',
  'agent_session_unavailable',
  'tool_error',
  'tool_config_invalid',
  'invocation_interrupted',
]);

const stepErrorSchema = z
  .object({
    reason: stepErrorReasonSchema.optional(),
    category: z.enum(['setup', 'user']).optional(),
  })
  .strict()
  .nullable();

const sourceLocationSchema = z
  .object({
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
  })
  .strict();

const gateResultSchema = z
  .object({
    kind: z.enum([
      'none',
      'not_evaluated',
      'passed',
      'failed',
      'uncheckable',
      'evaluation_error',
      'unknown',
    ]),
    passed: z.boolean().optional(),
    source: textSchema.optional(),
    exit_code: z.number().int().nullable().optional(),
  })
  .strict()
  .nullable();

const runnerSchema = z.array(shortTextSchema).max(AGENT_ACCESS_RUNNER_LABEL_MAX_ITEMS).nullable();

const evaluationTraceValueSchema = z
  .object({
    expression: textSchema,
    roots: z.array(shortTextSchema).max(AGENT_ACCESS_EVALUATION_TRACE_ROOT_MAX_ITEMS),
    roots_truncated: z.literal(true).optional(),
    roots_total_count: z.number().int().nonnegative().optional(),
    fill_target: shortTextSchema,
    evaluated_at: textSchema,
    field: shortTextSchema,
    value: textSchema.optional(),
    truncated: z.boolean().optional(),
    expr_truncated: z.boolean().optional(),
    reference: z.boolean().optional(),
    degraded: z.boolean().optional(),
    env_key: shortTextSchema.optional(),
  })
  .strict();

const evaluationTraceLimitSchema = z
  .object({
    truncated: z.literal(true),
    dropped: z.number().int().nonnegative(),
  })
  .strict();

const evaluationTraceEntrySchema = z.union([
  evaluationTraceValueSchema,
  evaluationTraceLimitSchema,
]);

const evaluationTraceSchema = z
  .array(evaluationTraceEntrySchema)
  .max(AGENT_ACCESS_EVALUATION_TRACE_MAX_ITEMS + 1);

const runnerMetadataSchema = {
  runner_truncated: z.literal(true).optional(),
  runner_total_count: z.number().int().nonnegative().optional(),
};

const dependencyMetadataSchema = {
  dependencies_truncated: z.literal(true).optional(),
  dependencies_total_count: z.number().int().nonnegative().optional(),
};

const attemptResultSchema = z
  .object({
    id: idSchema,
    attempt: z.number().int().positive(),
    execution_order: z.number().int().positive(),
    status: textSchema,
    exit_code: z.number().int().nullable(),
    gate_result: gateResultSchema,
    restart_feedback: textSchema.nullable(),
    started_at: dateTimeSchema,
    finished_at: dateTimeSchema.nullable(),
  })
  .strict();

const attemptsMetadataSchema = {
  attempts_truncated: z.literal(true).optional(),
  attempts_total_count: z.number().int().nonnegative().optional(),
};

const stepResultSchema = z
  .object({
    id: idSchema,
    key: textSchema.nullable(),
    name: textSchema,
    type: textSchema,
    status: textSchema,
    status_reason: textSchema.nullable(),
    error: stepErrorSchema,
    exit_code: z.number().int().nullable(),
    source_location: sourceLocationSchema.nullable(),
    position: z.number(),
    current_attempt: z.number().int(),
    attempts: z.array(attemptResultSchema).max(AGENT_ACCESS_WORKFLOW_RUN_STEP_ATTEMPT_MAX_ITEMS),
    ...attemptsMetadataSchema,
  })
  .strict();

const stepsMetadataSchema = {
  steps_truncated: z.literal(true).optional(),
  steps_total_count: z.number().int().nonnegative().optional(),
};

const jobExecutionResultSchema = z
  .object({
    id: idSchema,
    sequence: z.number().int().positive(),
    name: textSchema,
    status: textSchema,
    status_reason: textSchema.nullable(),
    status_reason_message: textSchema.nullable(),
    runner: runnerSchema,
    ...runnerMetadataSchema,
    queued_at: dateTimeSchema.nullable(),
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    timed_out_at: dateTimeSchema.nullable(),
    steps: z.array(stepResultSchema).max(AGENT_ACCESS_WORKFLOW_RUN_STEP_MAX_ITEMS),
    ...stepsMetadataSchema,
  })
  .strict();

const jobExecutionsMetadataSchema = {
  job_executions_truncated: z.literal(true).optional(),
  job_executions_total_count: z.number().int().nonnegative().optional(),
};

const jobResultSchema = z
  .object({
    id: idSchema,
    key: textSchema,
    name: textSchema.nullable(),
    mode: jobModeSchema,
    status: jobStatusSchema,
    status_reason: textSchema.nullable(),
    carried_over: z.boolean(),
    runner: runnerSchema,
    ...runnerMetadataSchema,
    listener_status: listenerStatusSchema,
    resolution_reason: resolutionReasonSchema.nullable(),
    dependencies: z.array(shortTextSchema).max(AGENT_ACCESS_DEPENDENCY_MAX_ITEMS),
    ...dependencyMetadataSchema,
    position: z.number(),
    created_at: dateTimeSchema,
    updated_at: dateTimeSchema,
    job_executions: z
      .array(jobExecutionResultSchema)
      .max(AGENT_ACCESS_WORKFLOW_RUN_JOB_EXECUTION_MAX_ITEMS),
    ...jobExecutionsMetadataSchema,
  })
  .strict();

const jobsMetadataSchema = {
  jobs_truncated: z.literal(true).optional(),
  jobs_total_count: z.number().int().nonnegative().optional(),
};

const jobStatusCountSchema = z
  .object({
    status: jobStatusSchema,
    count: z.number().int().positive(),
  })
  .strict();

const runAttemptSchema = z
  .object({
    id: idSchema,
    workflow_run_id: idSchema,
    attempt: z.number().int().positive(),
    status: runStatusSchema,
    created_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    rerun_mode: z.enum(['all', 'failed']).nullable(),
  })
  .strict();

export const getWorkflowRunResultSchema = z
  .object({
    id: idSchema,
    project_id: idSchema,
    definition_id: idSchema,
    number: z.number().int().positive(),
    name: textSchema,
    workflow_name: textSchema,
    status: runStatusSchema,
    origin: runOriginSchema,
    dev_source: runDevSourceSchema.nullable(),
    current_attempt: z.number().int().positive(),
    latest_attempt: z.number().int().positive(),
    trigger_provider: textSchema.nullable(),
    trigger_source: textSchema,
    trigger_event: textSchema,
    trigger_reference: runTriggerReferenceSchema.nullable(),
    job_status_counts: z.array(jobStatusCountSchema),
    has_started_job_execution: z.boolean(),
    created_at: dateTimeSchema,
    updated_at: dateTimeSchema,
    started_at: dateTimeSchema.nullable(),
    finished_at: dateTimeSchema.nullable(),
    run_attempt: runAttemptSchema,
    trigger_event_id: idSchema.nullable(),
    inputs: serializedJsonSchema,
    inputs_truncated: z.literal(true).optional(),
    inputs_total_bytes: z.number().int().nonnegative().optional(),
    jobs: z.array(jobResultSchema).max(AGENT_ACCESS_WORKFLOW_RUN_JOB_MAX_ITEMS),
    ...jobsMetadataSchema,
  })
  .strict();

export const getStepAttemptResultSchema = z
  .object({
    step_id: idSchema,
    attempt: z.number().int().positive(),
    authored_config: serializedJsonSchema,
    authored_config_truncated: z.literal(true).optional(),
    authored_config_total_bytes: z.number().int().nonnegative().optional(),
    config: serializedJsonSchema,
    config_truncated: z.literal(true).optional(),
    config_total_bytes: z.number().int().nonnegative().optional(),
    evaluation_trace: evaluationTraceSchema.nullable(),
    evaluation_trace_truncated: z.literal(true).optional(),
    evaluation_trace_dropped: z.number().int().nonnegative().optional(),
  })
  .strict();

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
    payload: serializedJsonSchema,
    payload_truncated: z.literal(true).optional(),
    payload_total_bytes: z.number().int().nonnegative().optional(),
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

export type GetWorkflowRunResultDto = z.infer<typeof getWorkflowRunResultSchema>;
export type GetStepAttemptResultDto = z.infer<typeof getStepAttemptResultSchema>;
export type GetTriggerEventResultDto = z.infer<typeof getTriggerEventResultSchema>;
export type GetTriggerEventFacetsResultDto = z.infer<typeof getTriggerEventFacetsResultSchema>;

const attemptJsonSchema = {
  type: 'integer',
  minimum: 1,
  maximum: AGENT_ACCESS_ATTEMPT_MAX,
} as const;

export const getWorkflowRunInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    attempt: attemptJsonSchema,
  },
  required: ['run_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getStepAttemptInputJsonSchema = {
  type: 'object',
  properties: {
    step_id: uuid,
    attempt: attemptJsonSchema,
  },
  required: ['step_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getTriggerEventInputJsonSchema = {
  type: 'object',
  properties: {event_id: uuid},
  required: ['event_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getTriggerEventFacetsInputJsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const runDevSourceJsonSchema = {
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

const runTriggerReferenceJsonSchema = {
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

const runAttemptJsonSchema = {
  type: 'object',
  properties: {
    id: uuid,
    workflow_run_id: uuid,
    attempt: {type: 'integer', minimum: 1},
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

const runnerJsonSchema = {
  type: 'array',
  maxItems: AGENT_ACCESS_RUNNER_LABEL_MAX_ITEMS,
  items: shortText,
} as const;

const nullableRunnerJsonSchema = nullable(runnerJsonSchema);
const runnerMetadataJsonSchema = {
  runner_truncated: {const: true},
  runner_total_count: {type: 'integer', minimum: 0},
} as const;
const dependencyMetadataJsonSchema = {
  dependencies_truncated: {const: true},
  dependencies_total_count: {type: 'integer', minimum: 0},
} as const;
const attemptsMetadataJsonSchema = {
  attempts_truncated: {const: true},
  attempts_total_count: {type: 'integer', minimum: 0},
} as const;
const stepsMetadataJsonSchema = {
  steps_truncated: {const: true},
  steps_total_count: {type: 'integer', minimum: 0},
} as const;
const executionsMetadataJsonSchema = {
  job_executions_truncated: {const: true},
  job_executions_total_count: {type: 'integer', minimum: 0},
} as const;
const jobsMetadataJsonSchema = {
  jobs_truncated: {const: true},
  jobs_total_count: {type: 'integer', minimum: 0},
} as const;

const gateResultJsonSchema = nullable({
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'none',
        'not_evaluated',
        'passed',
        'failed',
        'uncheckable',
        'evaluation_error',
        'unknown',
      ],
    },
    passed: {type: 'boolean'},
    source: text,
    exit_code: nullable({type: 'integer'}),
  },
  required: ['kind'],
  additionalProperties: false,
});

const errorJsonSchema = nullable({
  type: 'object',
  properties: {
    reason: {
      type: 'string',
      enum: [
        'checkout_failed',
        'checkout_auth_failed',
        'checkout_unavailable',
        'checkout_path_invalid',
        'checkout_destination_occupied',
        'git_unavailable',
        'workspace_prep_failed',
        'setup_aborted',
        'config_unresolvable',
        'output_invalid',
        'agent_config_invalid',
        'agent_invocation_failed',
        'agent_harness_unavailable',
        'agent_session_key_invalid',
        'agent_session_held',
        'agent_session_harness_mismatch',
        'agent_session_unavailable',
        'tool_error',
        'tool_config_invalid',
        'invocation_interrupted',
      ],
    },
    category: {type: 'string', enum: ['setup', 'user']},
  },
  additionalProperties: false,
});

const attemptJsonResultSchema = {
  type: 'object',
  properties: {
    id: uuid,
    attempt: {type: 'integer', minimum: 1},
    execution_order: {type: 'integer', minimum: 1},
    status: text,
    exit_code: nullable({type: 'integer'}),
    gate_result: gateResultJsonSchema,
    restart_feedback: nullable(text),
    started_at: dateTime,
    finished_at: nullable(dateTime),
  },
  required: [
    'id',
    'attempt',
    'execution_order',
    'status',
    'exit_code',
    'gate_result',
    'restart_feedback',
    'started_at',
    'finished_at',
  ],
  additionalProperties: false,
} as const;

const stepJsonResultSchema = {
  type: 'object',
  properties: {
    id: uuid,
    key: nullable(shortText),
    name: text,
    type: text,
    status: text,
    status_reason: nullable(text),
    error: errorJsonSchema,
    exit_code: nullable({type: 'integer'}),
    source_location: nullable({
      type: 'object',
      properties: {
        start_line: {type: 'integer', minimum: 1},
        end_line: {type: 'integer', minimum: 1},
      },
      required: ['start_line', 'end_line'],
      additionalProperties: false,
    }),
    position: {type: 'number'},
    current_attempt: {type: 'integer'},
    attempts: {
      type: 'array',
      maxItems: AGENT_ACCESS_WORKFLOW_RUN_STEP_ATTEMPT_MAX_ITEMS,
      items: attemptJsonResultSchema,
    },
    ...attemptsMetadataJsonSchema,
  },
  required: [
    'id',
    'key',
    'name',
    'type',
    'status',
    'status_reason',
    'error',
    'exit_code',
    'source_location',
    'position',
    'current_attempt',
    'attempts',
  ],
  additionalProperties: false,
} as const;

const executionJsonResultSchema = {
  type: 'object',
  properties: {
    id: uuid,
    sequence: {type: 'integer', minimum: 1},
    name: text,
    status: text,
    status_reason: nullable(text),
    status_reason_message: nullable(text),
    runner: nullableRunnerJsonSchema,
    ...runnerMetadataJsonSchema,
    queued_at: nullable(dateTime),
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    timed_out_at: nullable(dateTime),
    steps: {
      type: 'array',
      maxItems: AGENT_ACCESS_WORKFLOW_RUN_STEP_MAX_ITEMS,
      items: stepJsonResultSchema,
    },
    ...stepsMetadataJsonSchema,
  },
  required: [
    'id',
    'sequence',
    'name',
    'status',
    'status_reason',
    'status_reason_message',
    'runner',
    'queued_at',
    'started_at',
    'finished_at',
    'timed_out_at',
    'steps',
  ],
  additionalProperties: false,
} as const;

const jobJsonResultSchema = {
  type: 'object',
  properties: {
    id: uuid,
    key: text,
    name: nullable(text),
    mode: {type: 'string', enum: ['one_shot', 'listening']},
    status: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'],
    },
    status_reason: nullable(text),
    carried_over: {type: 'boolean'},
    runner: nullableRunnerJsonSchema,
    ...runnerMetadataJsonSchema,
    listener_status: {type: 'string', enum: ['inactive', 'listening', 'resolved']},
    resolution_reason: nullable({
      type: 'string',
      enum: ['until', 'timeout', 'max_executions', 'cancelled'],
    }),
    dependencies: {
      type: 'array',
      maxItems: AGENT_ACCESS_DEPENDENCY_MAX_ITEMS,
      items: shortText,
    },
    ...dependencyMetadataJsonSchema,
    position: {type: 'number'},
    created_at: dateTime,
    updated_at: dateTime,
    job_executions: {
      type: 'array',
      maxItems: AGENT_ACCESS_WORKFLOW_RUN_JOB_EXECUTION_MAX_ITEMS,
      items: executionJsonResultSchema,
    },
    ...executionsMetadataJsonSchema,
  },
  required: [
    'id',
    'key',
    'name',
    'mode',
    'status',
    'status_reason',
    'carried_over',
    'runner',
    'listener_status',
    'resolution_reason',
    'dependencies',
    'position',
    'created_at',
    'updated_at',
    'job_executions',
  ],
  additionalProperties: false,
} as const;

const workflowRunJsonResultSchema = {
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
    dev_source: nullable(runDevSourceJsonSchema),
    current_attempt: {type: 'integer', minimum: 1},
    latest_attempt: {type: 'integer', minimum: 1},
    trigger_provider: nullable(text),
    trigger_source: text,
    trigger_event: text,
    trigger_reference: nullable(runTriggerReferenceJsonSchema),
    job_status_counts: {type: 'array', items: jobStatusCountJsonSchema},
    has_started_job_execution: {type: 'boolean'},
    created_at: dateTime,
    updated_at: dateTime,
    started_at: nullable(dateTime),
    finished_at: nullable(dateTime),
    run_attempt: runAttemptJsonSchema,
    trigger_event_id: nullable(uuid),
    inputs: serializedJson,
    inputs_truncated: {const: true},
    inputs_total_bytes: {type: 'integer', minimum: 0},
    jobs: {
      type: 'array',
      maxItems: AGENT_ACCESS_WORKFLOW_RUN_JOB_MAX_ITEMS,
      items: jobJsonResultSchema,
    },
    ...jobsMetadataJsonSchema,
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
    'run_attempt',
    'trigger_event_id',
    'inputs',
    'jobs',
  ],
  additionalProperties: false,
} as const;

export const getWorkflowRunResultJsonSchema =
  workflowRunJsonResultSchema satisfies AgentAccessObjectSchema;

const traceValueJsonSchema = {
  type: 'object',
  properties: {
    expression: text,
    roots: {
      type: 'array',
      maxItems: AGENT_ACCESS_EVALUATION_TRACE_ROOT_MAX_ITEMS,
      items: shortText,
    },
    roots_truncated: {const: true},
    roots_total_count: {type: 'integer', minimum: 0},
    fill_target: shortText,
    evaluated_at: text,
    field: shortText,
    value: text,
    truncated: {type: 'boolean'},
    expr_truncated: {type: 'boolean'},
    reference: {type: 'boolean'},
    degraded: {type: 'boolean'},
    env_key: shortText,
  },
  required: ['expression', 'roots', 'fill_target', 'evaluated_at', 'field'],
  additionalProperties: false,
} as const;
const traceLimitJsonSchema = {
  type: 'object',
  properties: {truncated: {const: true}, dropped: {type: 'integer', minimum: 0}},
  required: ['truncated', 'dropped'],
  additionalProperties: false,
} as const;
const traceEntryJsonSchema = {
  anyOf: [traceValueJsonSchema, traceLimitJsonSchema],
} as const;

export const getStepAttemptResultJsonSchema = {
  type: 'object',
  properties: {
    step_id: uuid,
    attempt: {type: 'integer', minimum: 1},
    authored_config: serializedJson,
    authored_config_truncated: {const: true},
    authored_config_total_bytes: {type: 'integer', minimum: 0},
    config: serializedJson,
    config_truncated: {const: true},
    config_total_bytes: {type: 'integer', minimum: 0},
    evaluation_trace: nullable({
      type: 'array',
      maxItems: AGENT_ACCESS_EVALUATION_TRACE_MAX_ITEMS + 1,
      items: traceEntryJsonSchema,
    }),
    evaluation_trace_truncated: {const: true},
    evaluation_trace_dropped: {type: 'integer', minimum: 0},
  },
  required: ['step_id', 'attempt', 'authored_config', 'config', 'evaluation_trace'],
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
    payload: serializedJson,
    payload_truncated: {const: true},
    payload_total_bytes: {type: 'integer', minimum: 0},
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
    'payload',
    'decisions',
    'decisions_total_count',
    'replays',
    'replays_total_count',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getTriggerEventFacetsResultJsonSchema = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: {
        type: 'object',
        properties: {
          value: {type: 'string', maxLength: AGENT_ACCESS_FACET_VALUE_MAX_BYTES},
          count: {type: 'integer', minimum: 0},
        },
        required: ['value', 'count'],
        additionalProperties: false,
      },
    },
    events: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: {
        type: 'object',
        properties: {
          value: {type: 'string', maxLength: AGENT_ACCESS_FACET_VALUE_MAX_BYTES},
          count: {type: 'integer', minimum: 0},
        },
        required: ['value', 'count'],
        additionalProperties: false,
      },
    },
    origins: {
      type: 'array',
      maxItems: AGENT_ACCESS_FACET_MAX_ITEMS,
      items: {
        type: 'object',
        properties: {
          value: {type: 'string', maxLength: AGENT_ACCESS_FACET_VALUE_MAX_BYTES},
          count: {type: 'integer', minimum: 0},
        },
        required: ['value', 'count'],
        additionalProperties: false,
      },
    },
  },
  required: ['sources', 'events', 'origins'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
