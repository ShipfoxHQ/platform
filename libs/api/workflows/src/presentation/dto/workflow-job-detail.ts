import type {
  JobExecutionSummaryDto,
  StepAttemptSummaryDto,
  StepGateResultSummaryDto,
  StepSummaryDto,
  WorkflowExecutionStepsResponseDto,
  WorkflowJobDetailDto,
  WorkflowJobExecutionDetailDto,
  WorkflowJobExecutionSummariesResponseDto,
  WorkflowStepAttemptSummariesResponseDto,
} from '@shipfox/api-workflows-dto';
import {encodeNumberIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import type {StepType} from '#core/entities/step.js';
import type {
  WorkflowJobDetailRead,
  WorkflowJobExecutionDetailRead,
  WorkflowJobExecutionPageRead,
  WorkflowStepAttemptPageRead,
  WorkflowStepAttemptSummaryRead,
  WorkflowStepPageRead,
  WorkflowStepSummaryRead,
} from '#db/workflow-runs/job-detail.js';
import type {WorkflowRunJobExecutionSummary} from '#db/workflow-runs/overview.js';
import {toStepErrorDto, toStepGateResultDto} from './step.js';
import {toJobOverviewDto} from './workflow-run.js';

export function toWorkflowJobDetailDto(read: WorkflowJobDetailRead): WorkflowJobDetailDto {
  return {
    workflow_run_id: read.workflowRunId,
    workflow_run_attempt: read.workflowRunAttempt,
    job: toJobOverviewDto(read.job),
    selected_execution: read.selectedExecution
      ? toWorkflowJobExecutionDetailDto(read.selectedExecution)
      : null,
  };
}

export function toWorkflowJobExecutionSummariesResponseDto(
  page: WorkflowJobExecutionPageRead,
): WorkflowJobExecutionSummariesResponseDto {
  return {
    items: page.items.map(toJobExecutionSummaryDto),
    next_cursor: page.nextCursor
      ? encodeNumberIdCursor({value: page.nextCursor.sequence, id: page.nextCursor.id})
      : null,
    ...(page.total === undefined ? {} : {total: page.total}),
  };
}

export function toWorkflowExecutionStepsResponseDto(
  page: WorkflowStepPageRead,
): WorkflowExecutionStepsResponseDto {
  return toStepPageDto(page);
}

export function toWorkflowStepAttemptSummariesResponseDto(
  page: WorkflowStepAttemptPageRead,
): WorkflowStepAttemptSummariesResponseDto {
  return toStepAttemptPageDto(page, page.stepType);
}

function toWorkflowJobExecutionDetailDto(
  execution: WorkflowJobExecutionDetailRead,
): WorkflowJobExecutionDetailDto {
  return {
    ...toJobExecutionSummaryDto(execution),
    has_context: execution.hasContext,
    steps: toStepPageDto(execution.steps),
  };
}

function toJobExecutionSummaryDto(
  execution: WorkflowRunJobExecutionSummary,
): JobExecutionSummaryDto {
  return {
    id: execution.id,
    sequence: execution.sequence,
    name: execution.name,
    status: execution.status,
    display_status: execution.displayStatus,
    status_reason: execution.statusReason,
    status_reason_message: execution.statusReasonMessage,
    queued_at: execution.queuedAt?.toISOString() ?? null,
    started_at: execution.startedAt?.toISOString() ?? null,
    finished_at: execution.finishedAt?.toISOString() ?? null,
    timed_out_at: execution.timedOutAt?.toISOString() ?? null,
    updated_at: execution.updatedAt.toISOString(),
  };
}

function toStepPageDto(page: WorkflowStepPageRead): WorkflowExecutionStepsResponseDto {
  return {
    items: page.items.map(toStepSummaryDto),
    next_cursor: page.nextCursor ? encodeStepCursor(page.nextCursor) : null,
    ...(page.total === undefined ? {} : {total: page.total}),
  };
}

function toStepAttemptPageDto(
  page: WorkflowStepAttemptPageRead | WorkflowStepSummaryRead['attempts'],
  stepType: StepType,
): WorkflowStepAttemptSummariesResponseDto {
  return {
    items: page.items.map((attempt) => toStepAttemptSummaryDto(attempt, stepType)),
    next_cursor: page.nextCursor ? encodeAttemptCursor(page.nextCursor) : null,
    ...(page.total === undefined ? {} : {total: page.total}),
  };
}

function toStepSummaryDto(step: WorkflowStepSummaryRead): StepSummaryDto {
  return {
    id: step.id,
    key: step.key,
    name: step.name,
    type: step.type,
    position: step.position,
    status: step.status,
    status_reason: step.statusReason,
    source_location: step.sourceLocation
      ? {
          start_line: step.sourceLocation.startLine,
          end_line: step.sourceLocation.endLine,
        }
      : null,
    current_attempt: step.currentAttempt,
    error: toStepErrorDto(step.error, step.type),
    attempts: toStepAttemptPageDto(step.attempts, step.type),
  };
}

function toStepAttemptSummaryDto(
  attempt: WorkflowStepAttemptSummaryRead,
  stepType: StepType,
): StepAttemptSummaryDto {
  return {
    id: attempt.id,
    attempt: attempt.attempt,
    execution_order: attempt.executionOrder,
    status: attempt.status,
    exit_code: attempt.exitCode,
    started_at: attempt.startedAt.toISOString(),
    finished_at: attempt.finishedAt?.toISOString() ?? null,
    error: toStepErrorDto(attempt.error, stepType),
    gate_result: toStepGateResultSummaryDto(attempt.gateResult, attempt.status),
  };
}

function toStepGateResultSummaryDto(
  gateResult: Record<string, unknown> | null,
  status: string,
): StepGateResultSummaryDto {
  const result = toStepGateResultDto(gateResult, status);
  return result?.kind === 'unknown' ? {kind: 'unknown'} : result;
}

function encodeStepCursor(cursor: {position: number; id: string}): string {
  return encodeStringIdCursor({value: String(cursor.position), id: cursor.id});
}

function encodeAttemptCursor(cursor: {attempt: number; id: string}): string {
  return encodeNumberIdCursor({value: cursor.attempt, id: cursor.id});
}
