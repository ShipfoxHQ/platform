import {z} from 'zod';
import {evaluationTraceSchema} from './evaluation-trace.js';
import {workflowExecutionEventSchema} from './job-listening.js';
import {workflowRunAttemptDtoSchema, workflowSourceSnapshotSchema} from './workflow-run.js';

/**
 * Approved UTF-8 byte limits for fields that are loaded by diagnostic reads.
 * JSON values are measured using their serialized representation; text values
 * are measured as UTF-8 text. These limits keep an individual diagnostic
 * resource bounded while allowing the existing job-output contract to remain
 * the source of truth for derived job outputs.
 */
export const WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES = 64 * 1024;
export const WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES = 256 * 1024;
export const WORKFLOW_DIAGNOSTIC_EVALUATION_TRACE_MAX_BYTES = 64 * 1024;
export const WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES = 256 * 1024;
export const WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES = 8 * 1024;
export const WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES = 16 * 1024;
export const WORKFLOW_DIAGNOSTIC_GATE_RESULT_MAX_BYTES = 16 * 1024;
export const WORKFLOW_DIAGNOSTIC_CONDITION_MAX_BYTES = 64 * 1024;
export const WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES = 64 * 1024;

/** Reads retain headroom for legacy invocation histories. */
export const WORKFLOW_STEP_ATTEMPT_INVOCATION_READ_MAX = 10;

/** Maximum failed step-attempt coordinates returned to a run-level log read. */
export const WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT = 10;

const STEP_DIAGNOSTIC_FIELDS = [
  'authored_config',
  'config',
  'evaluation_trace',
  'output',
  'outputs',
  'response',
  'error',
  'gate_result',
  'restart_feedback',
] as const;

const CONTEXT_DIAGNOSTIC_FIELDS = [
  'job_outputs',
  'execution_outputs',
  'job_evaluation_trace',
  'execution_evaluation_trace',
  'condition',
  'trigger_events',
  'filter_snapshot',
] as const;

export const stepDiagnosticFieldSchema = z.enum(STEP_DIAGNOSTIC_FIELDS);
export type StepDiagnosticFieldDto = z.infer<typeof stepDiagnosticFieldSchema>;

export const workflowDiagnosticFieldSchema = z.enum([
  ...STEP_DIAGNOSTIC_FIELDS,
  ...CONTEXT_DIAGNOSTIC_FIELDS,
]);
export type WorkflowDiagnosticFieldDto = z.infer<typeof workflowDiagnosticFieldSchema>;

export const oversizedFieldDtoSchema = z.object({
  field: workflowDiagnosticFieldSchema,
  stored_bytes: z.number().int().nonnegative(),
  reason: z.enum([
    'legacy_value_exceeds_inline_limit',
    'value_exceeds_inline_limit',
    'value_truncated_at_write_limit',
  ]),
});

export type OversizedFieldDto = z.infer<typeof oversizedFieldDtoSchema>;

export const workflowRunSourceUnavailableReasonSchema = z.enum([
  'temporary_run',
  'pre_snapshot_run',
  'legacy_snapshot_too_large',
]);

export type WorkflowRunSourceUnavailableReasonDto = z.infer<
  typeof workflowRunSourceUnavailableReasonSchema
>;

export const workflowRunSourceResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('available'),
    workflow_run_id: z.string().uuid(),
    workflow_run_attempt: workflowRunAttemptDtoSchema.shape.attempt,
    source_snapshot: workflowSourceSnapshotSchema,
  }),
  z.object({
    kind: z.literal('unavailable'),
    workflow_run_id: z.string().uuid(),
    workflow_run_attempt: workflowRunAttemptDtoSchema.shape.attempt,
    reason: workflowRunSourceUnavailableReasonSchema,
  }),
]);

export type WorkflowRunSourceResponseDto = z.infer<typeof workflowRunSourceResponseSchema>;

export const workflowJobExecutionContextResponseSchema = z.object({
  workflow_run_id: z.string().uuid(),
  workflow_run_attempt: workflowRunAttemptDtoSchema.shape.attempt,
  job_id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  job_runner: z.array(z.string()).nullable(),
  execution_runner: z.array(z.string()).nullable(),
  job_outputs: z.record(z.string(), z.unknown()).nullable(),
  execution_outputs: z.record(z.string(), z.unknown()).nullable(),
  trigger_events: z.array(workflowExecutionEventSchema),
  job_evaluation_trace: evaluationTraceSchema.nullable(),
  execution_evaluation_trace: evaluationTraceSchema.nullable(),
  condition: z.string().nullable(),
  oversized_fields: z.array(oversizedFieldDtoSchema),
});

export type WorkflowJobExecutionContextResponseDto = z.infer<
  typeof workflowJobExecutionContextResponseSchema
>;
