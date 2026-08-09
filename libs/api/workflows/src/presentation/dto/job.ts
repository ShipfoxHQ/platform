import type {JobDto, JobExecutionDto} from '@shipfox/api-workflows-dto';
import type {Job} from '#core/entities/job.js';
import type {JobExecution} from '#core/entities/job-execution.js';
import {toEvaluationTraceDto} from './evaluation-trace.js';

export function toJobDto(job: Job): JobDto {
  return {
    id: job.id,
    run_attempt_id: job.workflowRunAttemptId,
    key: job.key,
    name: job.name,
    mode: job.mode,
    status: job.status,
    status_reason: job.statusReason,
    carried_over: job.carriedOver,
    success: job.success ?? null,
    runner: job.runner,
    evaluation_trace: toEvaluationTraceDto(job.evaluationTrace),
    listening:
      job.listeningOn === null
        ? null
        : {
            on: job.listeningOn,
            until: job.listeningUntil,
            timeout_ms: job.listeningTimeoutMs,
            max_executions: job.maxExecutions,
            batch:
              job.batchDebounceMs === null &&
              job.batchMaxSize === null &&
              job.batchMaxWaitMs === null
                ? null
                : {
                    ...(job.batchDebounceMs === null ? {} : {debounce_ms: job.batchDebounceMs}),
                    ...(job.batchMaxSize === null ? {} : {max_size: job.batchMaxSize}),
                    ...(job.batchMaxWaitMs === null ? {} : {max_wait_ms: job.batchMaxWaitMs}),
                  },
            on_resolve: job.onResolve ?? 'finish',
            execution_timeout_ms: job.executionTimeoutMs ?? null,
            name: job.name,
          },
    listener_status: job.listenerStatus,
    resolution_reason: job.resolutionReason,
    outputs: job.outputs,
    dependencies: job.dependencies,
    position: job.position,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
  };
}

export function toJobExecutionDto(jobExecution: JobExecution): JobExecutionDto {
  return {
    id: jobExecution.id,
    job_id: jobExecution.jobId,
    sequence: jobExecution.sequence,
    name: jobExecution.name,
    status: jobExecution.status,
    status_reason: jobExecution.statusReason,
    status_reason_message: jobExecution.statusReasonMessage,
    runner: jobExecution.runner,
    trigger_events: jobExecution.triggerEvents,
    outputs: jobExecution.outputs,
    evaluation_trace: toEvaluationTraceDto(jobExecution.evaluationTrace),
    queued_at: jobExecution.queuedAt?.toISOString() ?? null,
    started_at: jobExecution.startedAt?.toISOString() ?? null,
    finished_at: jobExecution.finishedAt?.toISOString() ?? null,
    timed_out_at: jobExecution.timedOutAt?.toISOString() ?? null,
    created_at: jobExecution.createdAt.toISOString(),
    updated_at: jobExecution.updatedAt.toISOString(),
  };
}
