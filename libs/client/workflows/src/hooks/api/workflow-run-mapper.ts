import type {
  JobListeningDto,
  StepAttemptDto,
  StepGateResultDto,
  WorkflowExecutionEventDto,
  WorkflowRunAttemptDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunListResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {
  Job,
  JobExecution,
  type JobListening,
  type Step,
  StepAttempt,
  type StepGateResult,
  type WorkflowExecutionEvent,
  type WorkflowRun,
  WorkflowRunAttempt,
  WorkflowRunAttemptSummary,
  type WorkflowRunDetail,
  type WorkflowRunListItem,
  type WorkflowRunListPage,
  workflowRunShortId,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from '#core/workflow-run.js';

export function toWorkflowRun(dto: WorkflowRunResponseDto): WorkflowRun {
  return {
    id: dto.id,
    projectId: dto.project_id,
    definitionId: dto.definition_id,
    name: dto.name,
    currentAttempt: dto.current_attempt,
    triggerProvider: dto.trigger_provider,
    triggerSource: dto.trigger_source,
    triggerEvent: dto.trigger_event,
    triggerDisplayLabel: workflowRunTriggerDisplayLabel({
      triggerSource: dto.trigger_source,
      triggerEvent: dto.trigger_event,
    }),
    triggerLabel: workflowRunTriggerLabel({
      triggerSource: dto.trigger_source,
      triggerEvent: dto.trigger_event,
    }),
    triggerPayload: dto.trigger_payload,
    inputs: dto.inputs ?? null,
    sourceSnapshot: dto.source_snapshot
      ? {content: dto.source_snapshot.content, format: dto.source_snapshot.format}
      : null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    shortId: workflowRunShortId(dto.id),
    isTemporary: dto.id.startsWith('temp-'),
  };
}

export function toWorkflowRunAttempt(dto: WorkflowRunAttemptDto): WorkflowRunAttempt {
  return new WorkflowRunAttempt({
    id: dto.id,
    workflowRunId: dto.workflow_run_id,
    attempt: dto.attempt,
    status: dto.status,
    createdAt: dto.created_at,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    rerunMode: dto.rerun_mode,
  });
}

export function toWorkflowRunListItem(dto: WorkflowRunResponseDto): WorkflowRunListItem {
  return {
    ...toWorkflowRun(dto),
    status: dto.status,
    latestAttempt: dto.latest_attempt,
    runAttempt: new WorkflowRunAttemptSummary({
      workflowRunId: dto.id,
      attempt: dto.current_attempt,
      status: dto.status,
      createdAt: dto.created_at,
      startedAt: dto.started_at ?? null,
      finishedAt: dto.finished_at ?? null,
    }),
  };
}

export function toWorkflowRunListPage(dto: WorkflowRunListResponseDto): WorkflowRunListPage {
  return {
    runs: dto.runs.map(toWorkflowRunListItem),
    nextCursor: dto.next_cursor,
    filteredTotalCount: dto.filtered_total_count,
  };
}

export function toWorkflowRunDetail(dto: WorkflowRunDetailResponseDto): WorkflowRunDetail {
  return {
    ...toWorkflowRun(dto),
    latestAttempt: dto.latest_attempt,
    runAttempt: toWorkflowRunAttempt(dto.run_attempt),
    jobs: dto.jobs.map(toJob),
  };
}

export function toJob(dto: WorkflowRunJobDetailDto): Job {
  return new Job({
    id: dto.id,
    runAttemptId: dto.run_attempt_id,
    key: dto.key,
    name: dto.name,
    mode: dto.mode,
    status: dto.status,
    statusReason: dto.status_reason,
    carriedOver: dto.carried_over,
    listening: dto.listening ? toJobListening(dto.listening) : null,
    listenerStatus: dto.listener_status,
    resolutionReason: dto.resolution_reason,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    jobExecutions: dto.job_executions.map(toJobExecution),
  });
}

export function toJobExecution(dto: WorkflowRunJobExecutionDetailDto): JobExecution {
  return new JobExecution({
    id: dto.id,
    jobId: dto.job_id,
    sequence: dto.sequence,
    name: dto.name,
    status: dto.status,
    statusReason: dto.status_reason,
    triggerEvents: (dto.trigger_events ?? []).map(toWorkflowExecutionEvent),
    queuedAt: dto.queued_at ?? null,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    timedOutAt: dto.timed_out_at ?? null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    steps: dto.steps.map(toStep),
  });
}

export function toStep(dto: WorkflowRunStepDetailDto): Step {
  return {
    id: dto.id,
    jobExecutionId: dto.job_execution_id,
    key: dto.key,
    name: dto.name,
    sourceLocation: dto.source_location
      ? {startLine: dto.source_location.start_line, endLine: dto.source_location.end_line}
      : null,
    status: dto.status,
    type: dto.type,
    config: dto.config,
    agentConfig: toAgentStepConfig(dto),
    error: dto.error
      ? {
          message: dto.error.message,
          exitCode: dto.error.exit_code ?? null,
          signal: dto.error.signal,
          reason: dto.error.reason,
          agentConfigIssue: dto.error.agent_config_issue,
          category: dto.error.category,
        }
      : null,
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) => toStepAttempt(attempt, dto.job_execution_id)),
  };
}

export function toStepAttempt(dto: StepAttemptDto, jobExecutionId: string): StepAttempt {
  return new StepAttempt({
    id: dto.id,
    stepId: dto.step_id,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
    error: dto.error ?? null,
    gateResult: toStepGateResult(dto.gate_result),
    restartFeedback: dto.restart_feedback ?? null,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at ?? null,
  });
}

function toJobListening(dto: JobListeningDto): JobListening {
  return {
    on: dto.on,
    until: dto.until,
    timeoutMs: dto.timeout_ms,
    maxExecutions: dto.max_executions,
    batch: dto.batch
      ? {
          debounceMs: dto.batch.debounce_ms,
          maxSize: dto.batch.max_size,
          maxWaitMs: dto.batch.max_wait_ms,
        }
      : null,
    onResolve: dto.on_resolve,
    executionTimeoutMs: dto.execution_timeout_ms,
    name: dto.name,
  };
}

function toWorkflowExecutionEvent(dto: WorkflowExecutionEventDto): WorkflowExecutionEvent {
  return {
    source: dto.source,
    event: dto.event,
    deliveryId: dto.delivery_id,
    receivedAt: dto.received_at,
    data: dto.data,
  };
}

function toStepGateResult(dto: StepGateResultDto): StepGateResult {
  if (dto === null || dto.kind === 'none' || dto.kind === 'not_evaluated') return dto;
  if (dto.kind === 'passed' || dto.kind === 'failed') return {...dto, exitCode: dto.exit_code};
  if (dto.kind === 'uncheckable' || dto.kind === 'evaluation_error')
    return {...dto, exitCode: dto.exit_code};
  return dto;
}

function toAgentStepConfig(dto: WorkflowRunStepDetailDto): Step['agentConfig'] {
  if (dto.type !== 'agent') return null;
  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function stringConfigValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
