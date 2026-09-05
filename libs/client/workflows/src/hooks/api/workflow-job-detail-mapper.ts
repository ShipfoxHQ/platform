import type {
  StepAttemptSummaryDto,
  StepSummaryDto,
  WorkflowExecutionStepsResponseDto,
  WorkflowJobDetailDto,
  WorkflowJobExecutionContextResponseDto,
  WorkflowJobExecutionDetailDto,
  WorkflowJobExecutionSummariesResponseDto,
  WorkflowStepAttemptSummariesResponseDto,
} from '@shipfox/api-workflows-dto';
import type {
  WorkflowExecutionStepsPage,
  WorkflowJobDetail,
  WorkflowJobExecutionContext,
  WorkflowJobExecutionDetail,
  WorkflowJobExecutionPage,
  WorkflowJobStepAttemptSummary,
  WorkflowJobStepSummary,
  WorkflowStepAttemptPage,
} from '#core/workflow-run.js';
import {Job, JobExecution, type Step, StepAttempt} from '#core/workflow-run.js';
import {toWorkflowDiagnosticUnavailableField} from './workflow-diagnostic-mapper.js';
import {
  toEvaluationTrace,
  toWorkflowExecutionEvent,
  toWorkflowJobGateResult,
  toWorkflowJobStepError,
} from './workflow-model-mapper.js';
import {toWorkflowRunOverviewExecution, toWorkflowRunOverviewJob} from './workflow-run-mapper.js';

export {toWorkflowJobStepError} from './workflow-model-mapper.js';

export function toWorkflowJobDetail(dto: WorkflowJobDetailDto): WorkflowJobDetail {
  return {
    workflowRunId: dto.workflow_run_id,
    workflowRunAttempt: dto.workflow_run_attempt,
    job: toWorkflowRunOverviewJob(dto.job),
    selectedExecution: dto.selected_execution
      ? toWorkflowJobExecutionDetail(dto.job.id, dto.selected_execution)
      : null,
  };
}

export function toWorkflowJobExecutionContext(
  dto: WorkflowJobExecutionContextResponseDto,
): WorkflowJobExecutionContext {
  return {
    workflowRunId: dto.workflow_run_id,
    workflowRunAttempt: dto.workflow_run_attempt,
    jobId: dto.job_id,
    jobExecutionId: dto.job_execution_id,
    jobRunner: dto.job_runner,
    executionRunner: dto.execution_runner,
    jobOutputs: dto.job_outputs,
    executionOutputs: dto.execution_outputs,
    triggerEvents: dto.trigger_events.map(toWorkflowExecutionEvent),
    jobEvaluationTrace: toEvaluationTrace(dto.job_evaluation_trace),
    executionEvaluationTrace: toEvaluationTrace(dto.execution_evaluation_trace),
    condition: dto.condition,
    oversizedFields: dto.oversized_fields.map(toWorkflowDiagnosticUnavailableField),
  };
}

export function toWorkflowJobExecutionPage(
  dto: WorkflowJobExecutionSummariesResponseDto,
): WorkflowJobExecutionPage {
  return {
    items: dto.items.map(toWorkflowRunOverviewExecution),
    nextCursor: dto.next_cursor,
    ...(dto.total === undefined ? {} : {total: dto.total}),
  };
}

export function toWorkflowExecutionStepsPage(
  dto: WorkflowExecutionStepsResponseDto,
  jobExecutionId: string,
): WorkflowExecutionStepsPage {
  return {
    items: dto.items.map((step) => toWorkflowJobStepSummary(step, jobExecutionId)),
    nextCursor: dto.next_cursor,
    ...(dto.total === undefined ? {} : {total: dto.total}),
  };
}

export function toWorkflowStepAttemptPage(
  dto: WorkflowStepAttemptSummariesResponseDto,
  stepId: string,
  jobExecutionId?: string,
): WorkflowStepAttemptPage {
  return {
    items: dto.items.map((attempt) =>
      toWorkflowJobStepAttemptSummary(attempt, stepId, jobExecutionId),
    ),
    nextCursor: dto.next_cursor,
    ...(dto.total === undefined ? {} : {total: dto.total}),
  };
}

function toWorkflowJobExecutionDetail(
  jobId: string,
  dto: WorkflowJobExecutionDetailDto,
): WorkflowJobExecutionDetail {
  return {
    ...toWorkflowRunOverviewExecution(dto),
    jobId,
    hasContext: dto.has_context,
    steps: {
      items: dto.steps.items.map((step) => toWorkflowJobStepSummary(step, dto.id)),
      nextCursor: dto.steps.next_cursor,
      ...(dto.steps.total === undefined ? {} : {total: dto.steps.total}),
    },
  };
}

export function toWorkflowJobStepSummary(
  dto: StepSummaryDto,
  jobExecutionId: string,
): WorkflowJobStepSummary {
  return {
    id: dto.id,
    jobExecutionId,
    key: dto.key,
    name: dto.name,
    type: dto.type,
    position: dto.position,
    status: dto.status,
    statusReason: dto.status_reason,
    sourceLocation: dto.source_location
      ? {startLine: dto.source_location.start_line, endLine: dto.source_location.end_line}
      : null,
    currentAttempt: dto.current_attempt,
    error: toWorkflowJobStepError(dto.error),
    attempts: {
      items: dto.attempts.items.map((attempt) =>
        toWorkflowJobStepAttemptSummary(attempt, dto.id, jobExecutionId),
      ),
      nextCursor: dto.attempts.next_cursor,
      ...(dto.attempts.total === undefined ? {} : {total: dto.attempts.total}),
    },
  };
}

export function toWorkflowJobStepAttemptSummary(
  dto: StepAttemptSummaryDto,
  stepId: string,
  jobExecutionId?: string,
): WorkflowJobStepAttemptSummary {
  return {
    id: dto.id,
    stepId,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    error: toWorkflowJobStepError(dto.error),
    gateResult: toWorkflowJobGateResult(dto.gate_result),
  };
}

export interface WorkflowJobDetailPresentationOptions {
  steps?: readonly WorkflowJobStepSummary[] | undefined;
  attemptsByStepId?: ReadonlyMap<string, readonly WorkflowJobStepAttemptSummary[]> | undefined;
}

export function mergeWorkflowJobStepSummaries(
  sources: readonly (readonly WorkflowJobStepSummary[])[],
): WorkflowJobStepSummary[] {
  return mergeById(sources);
}

export function mergeWorkflowJobStepAttempts(
  sources: readonly (readonly WorkflowJobStepAttemptSummary[])[],
): WorkflowJobStepAttemptSummary[] {
  return mergeById(sources);
}

/**
 * The job log components still accept the retained job model. Keep this conversion at the
 * presentation boundary: the selected-job query and its cache never acquire diagnostic fields.
 */
export function toJobForJobDetail(
  detail: WorkflowJobDetail,
  presentation: WorkflowJobDetailPresentationOptions = {},
): Job {
  const execution = detail.selectedExecution
    ? toJobExecutionForJobDetail(detail.job.id, detail.selectedExecution, presentation)
    : undefined;
  const updatedAt = execution?.updatedAt ?? detail.job.defaultExecution?.updatedAt ?? '';

  return new Job({
    id: detail.job.id,
    runAttemptId: detail.workflowRunId,
    key: detail.job.key,
    name: detail.job.name,
    mode: detail.job.mode,
    status: detail.job.status,
    statusReason: detail.job.statusReason,
    carriedOver: detail.job.carriedOver,
    outputs: null,
    success: null,
    runner: null,
    evaluationTrace: null,
    listening: null,
    listenerStatus: detail.job.listenerStatus,
    resolutionReason: null,
    dependencies: detail.job.dependencies,
    position: detail.job.position,
    createdAt: updatedAt,
    updatedAt,
    jobExecutions: execution ? [execution] : [],
  });
}

function toJobExecutionForJobDetail(
  jobId: string,
  detail: WorkflowJobExecutionDetail,
  presentation: WorkflowJobDetailPresentationOptions,
): JobExecution {
  const steps = presentation.steps ?? detail.steps.items;
  return new JobExecution({
    id: detail.id,
    jobId,
    sequence: detail.sequence,
    name: detail.name,
    status: detail.status,
    statusReason: detail.statusReason,
    statusReasonMessage: detail.statusReasonMessage,
    runner: null,
    outputs: null,
    triggerEvents: [],
    queuedAt: detail.queuedAt,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    timedOutAt: detail.timedOutAt,
    evaluationTrace: null,
    createdAt: detail.updatedAt,
    updatedAt: detail.updatedAt,
    steps: steps.map((step) =>
      toStepForJobDetail(step, detail.updatedAt, presentation.attemptsByStepId?.get(step.id)),
    ),
  });
}

function toStepForJobDetail(
  step: WorkflowJobStepSummary,
  fallbackUpdatedAt: string,
  presentedAttempts: readonly WorkflowJobStepAttemptSummary[] | undefined,
): Step {
  const attempts = presentedAttempts ?? step.attempts.items;
  const firstAttempt = attempts[0];
  const updatedAt = firstAttempt?.finishedAt ?? firstAttempt?.startedAt ?? fallbackUpdatedAt;
  return {
    id: step.id,
    jobExecutionId: step.jobExecutionId,
    key: step.key,
    name: step.name,
    sourceLocation: step.sourceLocation,
    status: step.status,
    statusReason: step.statusReason,
    type: step.type,
    config: {},
    evaluationTrace: null,
    agentConfig: null,
    toolConfig: null,
    error: step.error,
    position: step.position,
    currentAttempt: step.currentAttempt,
    createdAt: firstAttempt?.startedAt ?? fallbackUpdatedAt,
    updatedAt,
    attempts: attempts.map((attempt) => toStepAttemptForJobDetail(attempt, step.jobExecutionId)),
  };
}

/** Sources are ordered newest first, so delayed responses cannot overwrite fresher items. */
function mergeById<T extends {id: string}>(sources: readonly (readonly T[])[]): T[] {
  const merged = new Map<string, T>();
  for (const source of sources) {
    for (const item of source) {
      if (merged.has(item.id)) continue;
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

function toStepAttemptForJobDetail(
  attempt: WorkflowJobStepAttemptSummary,
  jobExecutionId: string,
): StepAttempt {
  return new StepAttempt({
    id: attempt.id,
    stepId: attempt.stepId,
    jobExecutionId: attempt.jobExecutionId ?? jobExecutionId,
    attempt: attempt.attempt,
    executionOrder: attempt.executionOrder,
    status: attempt.status,
    exitCode: attempt.exitCode,
    output: null,
    outputs: null,
    response: null,
    error: attempt.error ? {...attempt.error} : null,
    gateResult: attempt.gateResult,
    restartFeedback: null,
    invocations: [],
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
  });
}
