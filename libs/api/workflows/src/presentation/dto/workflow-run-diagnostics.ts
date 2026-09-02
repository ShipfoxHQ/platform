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
  storedBytes?: number | null,
): InlineDiagnostic<T> {
  const limitBytes = diagnosticByteLimit(field);
  if (storedBytes !== null && storedBytes !== undefined && storedBytes > limitBytes) {
    return {
      value: null,
      oversized: {
        field,
        stored_bytes: storedBytes,
        reason: 'legacy_value_exceeds_inline_limit',
      },
    };
  }
  if (value === null || value === undefined) return {value: null, oversized: null};

  const measuredBytes = diagnosticValueByteLength(value);
  if (measuredBytes <= limitBytes) return {value, oversized: null};

  return {
    value: null,
    oversized: {
      field,
      stored_bytes: measuredBytes,
      reason: 'legacy_value_exceeds_inline_limit',
    },
  };
}

export function toWorkflowRunSourceResponseDto(
  read: WorkflowRunSourceRead,
): WorkflowRunSourceResponseDto {
  if (
    read.sourceSnapshot === null &&
    read.sourceSnapshotBytes !== null &&
    read.sourceSnapshotBytes > WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES
  ) {
    return {
      kind: 'unavailable',
      workflow_run_id: read.workflowRunId,
      workflow_run_attempt: read.workflowRunAttempt,
      reason: 'legacy_snapshot_too_large',
    };
  }

  if (read.sourceSnapshot === null) {
    return {
      kind: 'unavailable',
      workflow_run_id: read.workflowRunId,
      workflow_run_attempt: read.workflowRunAttempt,
      reason: read.origin === 'dev' ? 'temporary_run' : 'pre_snapshot_run',
    };
  }

  if (
    (read.sourceSnapshotBytes ?? diagnosticValueByteLength(read.sourceSnapshot.content)) >
    WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES
  ) {
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
  const jobOutputs = inlineDiagnostic('job_outputs', read.jobOutputs, read.jobOutputsBytes);
  const executionOutputs = inlineDiagnostic(
    'execution_outputs',
    read.executionOutputs,
    read.executionOutputsBytes,
  );
  const jobEvaluationTrace = inlineDiagnostic(
    'job_evaluation_trace',
    read.jobEvaluationTrace,
    read.jobEvaluationTraceBytes,
  );
  const executionEvaluationTrace = inlineDiagnostic(
    'execution_evaluation_trace',
    read.executionEvaluationTrace,
    read.executionEvaluationTraceBytes,
  );
  const condition = inlineDiagnostic('condition', read.condition, read.conditionBytes);
  const triggerEvents = inlineDiagnostic(
    'trigger_events',
    read.triggerEvents,
    read.triggerEventsBytes,
  );

  return {
    workflow_run_id: read.workflowRunId,
    workflow_run_attempt: read.workflowRunAttempt,
    job_id: read.jobId,
    job_execution_id: read.jobExecutionId,
    job_runner: read.jobRunner,
    execution_runner: read.executionRunner,
    job_outputs: jobOutputs.value,
    execution_outputs: executionOutputs.value,
    trigger_events: triggerEvents.value ?? [],
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
      triggerEvents.oversized,
    ].filter((field): field is OversizedFieldDto => field !== null),
  };
}
