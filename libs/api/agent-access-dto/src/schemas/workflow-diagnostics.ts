import {z} from 'zod';
import type {AgentAccessObjectSchema} from './envelope.js';
import {AGENT_ACCESS_PAGE_LIMIT_MAX, AGENT_ACCESS_TEXT_MAX_BYTES} from './paged-tools.js';
import {dateTimeSchema, idSchema, utf8CappedString} from './primitives.js';

/** Smaller per-value allowance used by Agent Access before the common response ceiling. */
export const AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES = 16 * 1024;

/** Source is text, but it still needs enough room to be useful in a diagnostic response. */
export const AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES =
  AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES;

const textSchema = utf8CappedString(AGENT_ACCESS_TEXT_MAX_BYTES);
const sourceTextSchema = utf8CappedString(AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES);
const attemptSchema = z.number().int().min(1).max(2_147_483_647);

const diagnosticFields = [
  'authored_config',
  'config',
  'evaluation_trace',
  'output',
  'outputs',
  'response',
  'error',
  'gate_result',
  'restart_feedback',
  'job_outputs',
  'execution_outputs',
  'job_evaluation_trace',
  'execution_evaluation_trace',
  'condition',
  'trigger_events',
] as const;

export const agentAccessWorkflowDiagnosticFieldSchema = z.enum(diagnosticFields);
export type AgentAccessWorkflowDiagnosticFieldDto = z.infer<
  typeof agentAccessWorkflowDiagnosticFieldSchema
>;

const oversizedReasonSchema = z.enum([
  'legacy_value_exceeds_inline_limit',
  'value_exceeds_inline_limit',
  'value_truncated_at_write_limit',
]);

const oversizedFieldSchema = z
  .object({
    field: agentAccessWorkflowDiagnosticFieldSchema,
    stored_bytes: z.number().int().nonnegative(),
    reason: oversizedReasonSchema,
  })
  .strict();

export type AgentAccessOversizedFieldDto = z.infer<typeof oversizedFieldSchema>;

const evaluationTraceValueSchema = z
  .object({
    expression: textSchema,
    roots: z.array(textSchema),
    fill_target: textSchema,
    evaluated_at: textSchema,
    field: textSchema,
    value: textSchema.optional(),
    truncated: z.boolean().optional(),
    expr_truncated: z.boolean().optional(),
    reference: z.boolean().optional(),
    degraded: z.boolean().optional(),
    env_key: textSchema.optional(),
  })
  .strict();

const evaluationTraceLimitSchema = z
  .object({
    truncated: z.literal(true),
    dropped: z.number().int().nonnegative(),
  })
  .strict();

const evaluationTraceSchema = z.array(
  z.union([evaluationTraceValueSchema, evaluationTraceLimitSchema]),
);

const workflowExecutionEventSchema = z
  .object({
    source: textSchema,
    event: textSchema,
    delivery_id: textSchema,
    received_at: dateTimeSchema,
    project: z.object({id: idSchema}).strict().nullable(),
    repository: textSchema.nullable(),
    ref: textSchema.nullable(),
    commit: textSchema.nullable(),
    data: z.unknown(),
  })
  .strict();

const stepErrorSchema = z
  .object({
    message: textSchema,
    code: textSchema.optional(),
    managed_provider_id: textSchema.optional(),
    exit_code: z.number().int().nullable().optional(),
    signal: textSchema.optional(),
    reason: z
      .enum([
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
        'agent_inference_credentials_unavailable',
        'agent_session_key_invalid',
        'agent_session_held',
        'agent_session_harness_mismatch',
        'agent_session_unavailable',
        'execution_payload_too_large',
        'step_result_too_large',
        'diagnostic_too_large',
        'tool_error',
        'tool_config_invalid',
        'invocation_interrupted',
      ])
      .optional(),
    field: textSchema.optional(),
    source: textSchema.optional(),
    agent_config_issue: z
      .enum([
        'step_config_invalid',
        'provider_not_configured',
        'provider_unsupported',
        'model_unavailable',
        'credentials_invalid',
      ])
      .optional(),
    category: z.enum(['setup', 'user']).optional(),
    retryable: z.boolean().optional(),
    limit_bytes: z.number().int().positive().optional(),
    measured_bytes: z.number().int().positive().optional(),
    overshoot_bytes: z.number().int().positive().optional(),
  })
  .strict()
  .nullable();

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
    uncheckable: z.boolean().optional(),
    reason: textSchema.optional(),
    data: z.unknown().optional(),
  })
  .strict()
  .nullable();

const sessionSchema = z
  .object({
    id: idSchema,
    key: textSchema,
    mode: z.enum(['resume', 'fork']),
    segment: z.number().int().nonnegative(),
  })
  .strict()
  .nullable();

const invocationSchema = z
  .object({
    call_index: z.number().int().nonnegative(),
    started_at: textSchema,
    finished_at: textSchema.optional(),
    outcome: textSchema.optional(),
    error_code: textSchema.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    next_due_at: textSchema.optional(),
  })
  .strict();

export const getWorkflowRunSourceInputSchema = z
  .object({run_id: idSchema, attempt: attemptSchema})
  .strict();

export const getWorkflowExecutionContextInputSchema = z
  .object({job_id: idSchema, execution_id: idSchema})
  .strict();

export const getStepAttemptInputSchema = z
  .object({step_id: idSchema, attempt: attemptSchema.optional()})
  .strict();

export const listWorkflowRunJobExplanationsInputSchema = z
  .object({
    run_id: idSchema,
    attempt: attemptSchema,
    limit: z.number().int().min(1).max(AGENT_ACCESS_PAGE_LIMIT_MAX).default(100),
    cursor: z.string().min(1).optional(),
  })
  .strict();

export type GetWorkflowRunSourceInputDto = z.output<typeof getWorkflowRunSourceInputSchema>;
export type GetWorkflowExecutionContextInputDto = z.output<
  typeof getWorkflowExecutionContextInputSchema
>;
export type GetStepAttemptInputDto = z.output<typeof getStepAttemptInputSchema>;
export type ListWorkflowRunJobExplanationsInputDto = z.output<
  typeof listWorkflowRunJobExplanationsInputSchema
>;

const sourceSnapshotSchema = z
  .object({content: sourceTextSchema, format: z.literal('yaml')})
  .strict();

export const getWorkflowRunSourceResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('available'),
      workflow_run_id: idSchema,
      workflow_run_attempt: attemptSchema,
      source_snapshot: sourceSnapshotSchema,
      source_snapshot_truncated: z.literal(true).optional(),
      source_snapshot_total_bytes: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('unavailable'),
      workflow_run_id: idSchema,
      workflow_run_attempt: attemptSchema,
      reason: z.enum(['temporary_run', 'pre_snapshot_run', 'legacy_snapshot_too_large']),
    })
    .strict(),
]);

export type GetWorkflowRunSourceResultDto = z.infer<typeof getWorkflowRunSourceResultSchema>;

export const getWorkflowExecutionContextResultSchema = z
  .object({
    workflow_run_id: idSchema,
    workflow_run_attempt: attemptSchema,
    job_id: idSchema,
    job_execution_id: idSchema,
    job_runner: z.array(textSchema).nullable(),
    execution_runner: z.array(textSchema).nullable(),
    job_outputs: z.unknown().nullable(),
    execution_outputs: z.unknown().nullable(),
    trigger_events: z.array(workflowExecutionEventSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    job_evaluation_trace: evaluationTraceSchema.nullable(),
    execution_evaluation_trace: evaluationTraceSchema.nullable(),
    condition: textSchema.nullable(),
    oversized_fields: z.array(oversizedFieldSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
  })
  .strict();

export type GetWorkflowExecutionContextResultDto = z.infer<
  typeof getWorkflowExecutionContextResultSchema
>;

export const getStepAttemptResultSchema = z
  .object({
    workflow_run_id: idSchema,
    workflow_run_attempt: attemptSchema,
    job_id: idSchema,
    job_execution_id: idSchema,
    step_id: idSchema,
    step_attempt_id: idSchema,
    attempt: attemptSchema,
    authored_config: z.unknown().nullable(),
    config: z.unknown().nullable(),
    session: sessionSchema,
    evaluation_trace: evaluationTraceSchema.nullable(),
    output: z.unknown().nullable(),
    outputs: z.unknown().nullable(),
    response: textSchema.nullable(),
    error: stepErrorSchema,
    gate_result: gateResultSchema,
    invocations: z.array(invocationSchema).max(10),
    restart_feedback: textSchema.nullable(),
    oversized_fields: z.array(oversizedFieldSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
  })
  .strict();

export type GetStepAttemptResultDto = z.infer<typeof getStepAttemptResultSchema>;

const explanationSchema = z
  .object({
    job_id: idSchema,
    job_label: textSchema,
    job_position: z.number().int().nonnegative().max(2_147_483_647),
    status: z.enum(['failed', 'skipped']),
    status_reason: textSchema.nullable(),
    evaluation_trace: evaluationTraceSchema.nullable(),
  })
  .strict();

export const listWorkflowRunJobExplanationsResultSchema = z
  .object({
    workflow_run_id: idSchema,
    workflow_run_attempt: attemptSchema,
    explanations: z.array(explanationSchema).max(AGENT_ACCESS_PAGE_LIMIT_MAX),
    next_cursor: z.string().nullable(),
  })
  .strict();

export type ListWorkflowRunJobExplanationsResultDto = z.infer<
  typeof listWorkflowRunJobExplanationsResultSchema
>;

const uuid = {type: 'string', format: 'uuid'} as const;
const dateTime = {type: 'string', format: 'date-time'} as const;
const text = {type: 'string', maxLength: AGENT_ACCESS_TEXT_MAX_BYTES} as const;
const sourceText = {type: 'string', maxLength: AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES} as const;
const dynamicJson = {} as const;
const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]}) as const;
const nullableDynamicJson = nullable(dynamicJson);

export const getWorkflowRunSourceInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
  },
  required: ['run_id', 'attempt'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowExecutionContextInputJsonSchema = {
  type: 'object',
  properties: {job_id: uuid, execution_id: uuid},
  required: ['job_id', 'execution_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getStepAttemptInputJsonSchema = {
  type: 'object',
  properties: {
    step_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
  },
  required: ['step_id'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const listWorkflowRunJobExplanationsInputJsonSchema = {
  type: 'object',
  properties: {
    run_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    limit: {type: 'integer', minimum: 1, maximum: AGENT_ACCESS_PAGE_LIMIT_MAX, default: 100},
    cursor: {type: 'string', minLength: 1},
  },
  required: ['run_id', 'attempt'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const oversizedFieldJson = {
  type: 'object',
  properties: {
    field: {type: 'string', enum: diagnosticFields},
    stored_bytes: {type: 'integer', minimum: 0},
    reason: {
      type: 'string',
      enum: [
        'legacy_value_exceeds_inline_limit',
        'value_exceeds_inline_limit',
        'value_truncated_at_write_limit',
      ],
    },
  },
  required: ['field', 'stored_bytes', 'reason'],
  additionalProperties: false,
} as const;

const evaluationTraceValueJson = {
  type: 'object',
  properties: {
    expression: text,
    roots: {type: 'array', items: text},
    fill_target: text,
    evaluated_at: text,
    field: text,
    value: text,
    truncated: {type: 'boolean'},
    expr_truncated: {type: 'boolean'},
    reference: {type: 'boolean'},
    degraded: {type: 'boolean'},
    env_key: text,
  },
  required: ['expression', 'roots', 'fill_target', 'evaluated_at', 'field'],
  additionalProperties: false,
} as const;

const evaluationTraceJson = {
  type: 'array',
  items: {
    anyOf: [
      evaluationTraceValueJson,
      {
        type: 'object',
        properties: {truncated: {const: true}, dropped: {type: 'integer', minimum: 0}},
        required: ['truncated', 'dropped'],
        additionalProperties: false,
      },
    ],
  },
} as const;

const workflowExecutionEventJson = {
  type: 'object',
  properties: {
    source: text,
    event: text,
    delivery_id: text,
    received_at: dateTime,
    project: nullable({
      type: 'object',
      properties: {id: uuid},
      required: ['id'],
      additionalProperties: false,
    }),
    repository: nullable(text),
    ref: nullable(text),
    commit: nullable(text),
    data: dynamicJson,
  },
  required: [
    'source',
    'event',
    'delivery_id',
    'received_at',
    'project',
    'repository',
    'ref',
    'commit',
    'data',
  ],
  additionalProperties: false,
} as const;

const stepErrorJson = {
  type: 'object',
  properties: {
    message: text,
    code: text,
    managed_provider_id: text,
    exit_code: nullable({type: 'integer'}),
    signal: text,
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
        'agent_inference_credentials_unavailable',
        'agent_session_key_invalid',
        'agent_session_held',
        'agent_session_harness_mismatch',
        'agent_session_unavailable',
        'execution_payload_too_large',
        'step_result_too_large',
        'diagnostic_too_large',
        'tool_error',
        'tool_config_invalid',
        'invocation_interrupted',
      ],
    },
    field: text,
    source: text,
    agent_config_issue: {
      type: 'string',
      enum: [
        'step_config_invalid',
        'provider_not_configured',
        'provider_unsupported',
        'model_unavailable',
        'credentials_invalid',
      ],
    },
    category: {type: 'string', enum: ['setup', 'user']},
    retryable: {type: 'boolean'},
    limit_bytes: {type: 'integer', minimum: 1},
    measured_bytes: {type: 'integer', minimum: 1},
    overshoot_bytes: {type: 'integer', minimum: 1},
  },
  required: ['message'],
  additionalProperties: false,
} as const;

const gateResultJson = {
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
    uncheckable: {type: 'boolean'},
    reason: text,
    data: dynamicJson,
  },
  required: ['kind'],
  additionalProperties: false,
} as const;

const sessionJson = {
  type: 'object',
  properties: {
    id: uuid,
    key: text,
    mode: {type: 'string', enum: ['resume', 'fork']},
    segment: {type: 'integer', minimum: 0},
  },
  required: ['id', 'key', 'mode', 'segment'],
  additionalProperties: false,
} as const;

const invocationJson = {
  type: 'object',
  properties: {
    call_index: {type: 'integer', minimum: 0},
    started_at: text,
    finished_at: text,
    outcome: text,
    error_code: text,
    duration_ms: {type: 'integer', minimum: 0},
    next_due_at: text,
  },
  required: ['call_index', 'started_at'],
  additionalProperties: false,
} as const;

const sourceSnapshotJson = {
  type: 'object',
  properties: {content: sourceText, format: {const: 'yaml'}},
  required: ['content', 'format'],
  additionalProperties: false,
} as const;

export const getWorkflowRunSourceResultJsonSchema = {
  type: 'object',
  properties: {
    kind: {type: 'string', enum: ['available', 'unavailable']},
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    source_snapshot: sourceSnapshotJson,
    source_snapshot_truncated: {const: true},
    source_snapshot_total_bytes: {type: 'integer', minimum: 0},
    reason: {
      type: 'string',
      enum: ['temporary_run', 'pre_snapshot_run', 'legacy_snapshot_too_large'],
    },
  },
  required: ['kind', 'workflow_run_id', 'workflow_run_attempt'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getWorkflowExecutionContextResultJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    job_id: uuid,
    job_execution_id: uuid,
    job_runner: nullable({type: 'array', items: text}),
    execution_runner: nullable({type: 'array', items: text}),
    job_outputs: nullableDynamicJson,
    execution_outputs: nullableDynamicJson,
    trigger_events: {
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
      items: workflowExecutionEventJson,
    },
    job_evaluation_trace: nullable(evaluationTraceJson),
    execution_evaluation_trace: nullable(evaluationTraceJson),
    condition: nullable(text),
    oversized_fields: {
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
      items: oversizedFieldJson,
    },
  },
  required: [
    'workflow_run_id',
    'workflow_run_attempt',
    'job_id',
    'job_execution_id',
    'job_runner',
    'execution_runner',
    'job_outputs',
    'execution_outputs',
    'trigger_events',
    'job_evaluation_trace',
    'execution_evaluation_trace',
    'condition',
    'oversized_fields',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

export const getStepAttemptResultJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    job_id: uuid,
    job_execution_id: uuid,
    step_id: uuid,
    step_attempt_id: uuid,
    attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    authored_config: nullableDynamicJson,
    config: nullableDynamicJson,
    session: nullable(sessionJson),
    evaluation_trace: nullable(evaluationTraceJson),
    output: nullableDynamicJson,
    outputs: nullableDynamicJson,
    response: nullable(text),
    error: nullable(stepErrorJson),
    gate_result: nullable(gateResultJson),
    invocations: {type: 'array', maxItems: 10, items: invocationJson},
    restart_feedback: nullable(text),
    oversized_fields: {
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
      items: oversizedFieldJson,
    },
  },
  required: [
    'workflow_run_id',
    'workflow_run_attempt',
    'job_id',
    'job_execution_id',
    'step_id',
    'step_attempt_id',
    'attempt',
    'authored_config',
    'config',
    'session',
    'evaluation_trace',
    'output',
    'outputs',
    'response',
    'error',
    'gate_result',
    'invocations',
    'restart_feedback',
    'oversized_fields',
  ],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;

const explanationJson = {
  type: 'object',
  properties: {
    job_id: uuid,
    job_label: text,
    job_position: {type: 'integer', minimum: 0, maximum: 2_147_483_647},
    status: {type: 'string', enum: ['failed', 'skipped']},
    status_reason: nullable(text),
    evaluation_trace: nullable(evaluationTraceJson),
  },
  required: ['job_id', 'job_label', 'job_position', 'status', 'status_reason', 'evaluation_trace'],
  additionalProperties: false,
} as const;

export const listWorkflowRunJobExplanationsResultJsonSchema = {
  type: 'object',
  properties: {
    workflow_run_id: uuid,
    workflow_run_attempt: {type: 'integer', minimum: 1, maximum: 2_147_483_647},
    explanations: {type: 'array', maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX, items: explanationJson},
    next_cursor: nullable({type: 'string', minLength: 1}),
  },
  required: ['workflow_run_id', 'workflow_run_attempt', 'explanations', 'next_cursor'],
  additionalProperties: false,
} as const satisfies AgentAccessObjectSchema;
