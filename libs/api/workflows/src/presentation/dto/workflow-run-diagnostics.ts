import {
  type OversizedFieldDto,
  WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
  type WorkflowDiagnosticFieldDto,
  type WorkflowJobExecutionContextResponseDto,
  type WorkflowRunSourceResponseDto,
} from '@shipfox/api-workflows-dto';
import {diagnosticByteLimit, diagnosticValueByteLength} from '#core/diagnostics.js';
import type {WorkflowJobExecutionContextRead} from '#db/workflow-runs/job-detail.js';
import type {WorkflowRunSourceRead} from '#db/workflow-runs/source.js';
import {toEvaluationTraceDto} from './evaluation-trace.js';

export interface InlineDiagnostic<T> {
  value: T | null;
  oversized: OversizedFieldDto | null;
}

export function inlineDiagnostic<T>(
  field: WorkflowDiagnosticFieldDto,
  value: T | null | undefined,
): InlineDiagnostic<T> {
  if (value === null || value === undefined) return {value: null, oversized: null};

  const storedBytes = diagnosticValueByteLength(value);
  if (storedBytes <= diagnosticByteLimit(field)) return {value, oversized: null};

  return {
    value: null,
    oversized: {
      field,
      stored_bytes: storedBytes,
      reason: 'legacy_value_exceeds_inline_limit',
    },
  };
}

export function toWorkflowRunSourceResponseDto(
  read: WorkflowRunSourceRead,
): WorkflowRunSourceResponseDto {
  if (read.sourceSnapshot === null) {
    return {
      kind: 'unavailable',
      workflow_run_id: read.workflowRunId,
      workflow_run_attempt: read.workflowRunAttempt,
      reason: read.origin === 'dev' ? 'temporary_run' : 'pre_snapshot_run',
    };
  }

  if (diagnosticValueByteLength(read.sourceSnapshot.content) > WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES) {
    return {
      kind: 'unavailable',
      workflow_run_id: read.workflowRunId,
      workflow_run_attempt: read.workflowRunAttempt,
      reason: 'legacy_snapshot_too_large',
    };
  }

  return {
    kind: 'available',
    workflow_run_id: read.workflowRunId,
    workflow_run_attempt: read.workflowRunAttempt,
    source_snapshot: read.sourceSnapshot,
  };
}

export function toWorkflowJobExecutionContextResponseDto(
  read: WorkflowJobExecutionContextRead,
): WorkflowJobExecutionContextResponseDto {
  const jobOutputs = inlineDiagnostic('job_outputs', read.jobOutputs);
  const executionOutputs = inlineDiagnostic('execution_outputs', read.executionOutputs);
  const jobEvaluationTrace = inlineDiagnostic('job_evaluation_trace', read.jobEvaluationTrace);
  const executionEvaluationTrace = inlineDiagnostic(
    'execution_evaluation_trace',
    read.executionEvaluationTrace,
  );
  const condition = inlineDiagnostic('condition', read.condition);

  return {
    workflow_run_id: read.workflowRunId,
    workflow_run_attempt: read.workflowRunAttempt,
    job_id: read.jobId,
    job_execution_id: read.jobExecutionId,
    job_runner: read.jobRunner,
    execution_runner: read.executionRunner,
    job_outputs: jobOutputs.value,
    execution_outputs: executionOutputs.value,
    trigger_events: read.triggerEvents,
    job_evaluation_trace:
      jobEvaluationTrace.value === null ? null : toEvaluationTraceDto(jobEvaluationTrace.value),
    execution_evaluation_trace:
      executionEvaluationTrace.value === null
        ? null
        : toEvaluationTraceDto(executionEvaluationTrace.value),
    condition: condition.value,
    oversized_fields: [
      jobOutputs.oversized,
      executionOutputs.oversized,
      jobEvaluationTrace.oversized,
      executionEvaluationTrace.oversized,
      condition.oversized,
    ].filter((field): field is OversizedFieldDto => field !== null),
  };
}
