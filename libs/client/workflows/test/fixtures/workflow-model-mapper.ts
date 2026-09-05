import type {
  EvaluationTraceDto,
  JobExecutionSummaryDto,
  JobListeningDto,
  JobModeDto,
  JobStatusDto,
  JobStatusReasonDto,
  ListenerStatusDto,
  ResolutionReasonDto,
  StepAttemptDto,
  StepDto,
  WorkflowExecutionEventDto,
} from '@shipfox/api-workflows-dto';
import {Job, JobExecution, type JobListening, type Step, StepAttempt} from '#core/workflow-run.js';
import {
  recordConfigValue,
  toEvaluationTrace,
  toStepAttemptInvocation,
  toStepGateResult,
  toWorkflowExecutionEvent,
  toWorkflowJobStepError,
} from '#hooks/api/workflow-model-mapper.js';

export type WorkflowStepModelDto = StepDto & {
  exit_code: number | null;
  outputs: Record<string, unknown> | null;
  response: string | null;
  gate_result: StepAttemptDto['gate_result'];
  attempts: StepAttemptDto[];
};

export type WorkflowJobExecutionModelDto = {
  id: string;
  job_id: string;
  sequence: number;
  name: string;
  status: JobExecutionSummaryDto['status'];
  status_reason: JobExecutionSummaryDto['status_reason'];
  status_reason_message: string | null;
  runner: string[] | null;
  trigger_events: WorkflowExecutionEventDto[];
  outputs: Record<string, unknown> | null;
  evaluation_trace: EvaluationTraceDto | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  timed_out_at: string | null;
  created_at: string;
  updated_at: string;
  steps: WorkflowStepModelDto[];
};

export type WorkflowJobModelDto = {
  id: string;
  run_attempt_id: string;
  key: string;
  name: string | null;
  mode: JobModeDto;
  status: JobStatusDto;
  status_reason: JobStatusReasonDto | null;
  carried_over: boolean;
  success: string | null;
  runner: string[] | null;
  evaluation_trace: EvaluationTraceDto | null;
  listening: JobListeningDto | null;
  listener_status: ListenerStatusDto;
  resolution_reason: ResolutionReasonDto | null;
  outputs: Record<string, unknown> | null;
  dependencies: string[];
  position: number;
  created_at: string;
  updated_at: string;
  job_executions: WorkflowJobExecutionModelDto[];
};

export function toWorkflowJobModel(dto: WorkflowJobModelDto): Job {
  return new Job({
    id: dto.id,
    runAttemptId: dto.run_attempt_id,
    key: dto.key,
    name: dto.name,
    mode: dto.mode,
    status: dto.status,
    statusReason: dto.status_reason,
    carriedOver: dto.carried_over,
    outputs: dto.outputs,
    success: dto.success,
    runner: dto.runner,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    listening: dto.listening ? toWorkflowJobListening(dto.listening) : null,
    listenerStatus: dto.listener_status,
    resolutionReason: dto.resolution_reason,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    jobExecutions: dto.job_executions.map(toWorkflowJobExecutionModel),
  });
}

export function toWorkflowJobExecutionModel(dto: WorkflowJobExecutionModelDto): JobExecution {
  return new JobExecution({
    id: dto.id,
    jobId: dto.job_id,
    sequence: dto.sequence,
    name: dto.name,
    status: dto.status,
    statusReason: dto.status_reason,
    statusReasonMessage: dto.status_reason_message,
    runner: dto.runner,
    outputs: dto.outputs,
    triggerEvents: dto.trigger_events.map(toWorkflowExecutionEvent),
    queuedAt: dto.queued_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    timedOutAt: dto.timed_out_at,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    steps: dto.steps.map(toWorkflowStepModel),
  });
}

export function toWorkflowStepModel(dto: WorkflowStepModelDto): Step {
  return {
    id: dto.id,
    jobExecutionId: dto.job_execution_id,
    key: dto.key,
    name: dto.name,
    sourceLocation: dto.source_location
      ? {startLine: dto.source_location.start_line, endLine: dto.source_location.end_line}
      : null,
    status: dto.status,
    statusReason: dto.status_reason,
    type: dto.type,
    config: dto.config,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    agentConfig: toWorkflowAgentStepConfig(dto),
    toolConfig: toWorkflowToolStepConfig(dto),
    error: toWorkflowJobStepError(dto.error),
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) =>
      toWorkflowStepAttemptModel(attempt, dto.job_execution_id),
    ),
  };
}

export function toWorkflowStepAttemptModel(
  dto: StepAttemptDto,
  jobExecutionId: string,
): StepAttempt {
  return new StepAttempt({
    id: dto.id,
    stepId: dto.step_id,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code,
    output: dto.output,
    outputs: dto.outputs ?? dto.output,
    response: dto.response,
    error: dto.error,
    gateResult: toStepGateResult(dto.gate_result),
    restartFeedback: dto.restart_feedback,
    invocations: dto.invocations.map(toStepAttemptInvocation),
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
  });
}

function toWorkflowJobListening(dto: JobListeningDto): JobListening {
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

function toWorkflowAgentStepConfig(dto: WorkflowStepModelDto): Step['agentConfig'] {
  if (dto.type !== 'agent') return null;
  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function toWorkflowToolStepConfig(dto: WorkflowStepModelDto): Step['toolConfig'] {
  if (dto.type !== 'tool') return null;
  const tool = recordConfigValue(dto.config.tool);
  const sensitivity = tool?.sensitivity;
  const method = stringConfigValue(tool?.method);
  return {
    provider: stringConfigValue(tool?.provider),
    connectionSlug: stringConfigValue(tool?.connection_slug),
    toolId: stringConfigValue(tool?.id),
    ...(method === null ? {} : {method}),
    sensitivity: sensitivity === 'read' || sensitivity === 'write' ? sensitivity : null,
  };
}

function stringConfigValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
