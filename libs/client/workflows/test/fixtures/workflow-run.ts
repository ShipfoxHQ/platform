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
  StepErrorDto,
  StepGateResultSummaryDto,
  WorkflowExecutionEventDto,
  WorkflowJobDetailDto,
  WorkflowRunAttemptDto,
  WorkflowRunAttemptsResponseDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunJobSummaryDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import {WORKFLOW_RUN_JOB_PREVIEW_LIMIT} from '@shipfox/api-workflows-dto';
import type {
  RunAnnotationEntry,
  RunAnnotationOrigin,
  RunAnnotationRecord,
} from '#core/run-annotation.js';
import type {
  Step,
  WorkflowRun,
  WorkflowRunListItem,
  WorkflowRunListPage,
  WorkflowRunOverviewJob,
} from '#core/workflow-run.js';
import {Job, JobExecution, StepAttempt, WorkflowRunAttempt} from '#core/workflow-run.js';
import {
  toEvaluationTrace,
  toWorkflowExecutionEvent,
  toWorkflowRunListItem,
  toWorkflowRunListPage,
  toWorkflowRunOverview,
  toWorkflowRunOverviewJob,
} from '#hooks/api/workflow-run-mapper.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ATTEMPT_ID = '11111111-1111-4111-8111-111111111112';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const JOB_ID = '44444444-4444-4444-8444-000000000001';
const JOB_EXECUTION_ID = '77777777-7777-4777-8777-000000000001';
const STEP_ID = '55555555-5555-4555-8555-000000000001';
const JOB_SUMMARY_ID_PREFIX = '44444444-4444-4444-8444-1';

let runSequence = 0;
let jobSequence = 0;
let jobSummarySequence = 0;
let jobExecutionSequence = 0;
let stepSequence = 0;
let attemptSequence = 0;

type RunAnnotationEntryOverrides = Partial<Omit<RunAnnotationEntry, 'annotation' | 'origin'>> & {
  origin?: Partial<RunAnnotationOrigin> | null | undefined;
};

/** An enriched annotation entry with server-owned provenance and focused per-case overrides. */
export function runAnnotationEntryFixture(
  annotation: RunAnnotationRecord,
  overrides: RunAnnotationEntryOverrides = {},
): RunAnnotationEntry {
  const {origin: originOverride, ...entryOverrides} = overrides;
  return {
    annotation,
    jobName: 'build',
    jobPosition: 0,
    executionSequence: 1,
    executionLabel: null,
    stepLabel: 'compile',
    attemptLabel: `attempt ${annotation.originStepAttempt}`,
    origin:
      originOverride === null
        ? null
        : {
            jobId: annotation.jobId,
            jobExecutionId: annotation.jobExecutionId,
            stepId: annotation.originStepId,
            stepAttemptId: STEP_ID,
            ...originOverride,
          },
    ...entryOverrides,
  };
}

export type WorkflowStepFixtureDto = StepDto & {
  exit_code: number | null;
  outputs: Record<string, unknown> | null;
  response: string | null;
  gate_result: StepAttemptDto['gate_result'];
  attempts: StepAttemptDto[];
};

export type WorkflowJobExecutionFixtureDto = {
  id: string;
  job_id: string;
  sequence: number;
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
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
  steps: WorkflowStepFixtureDto[];
};

export type WorkflowJobFixtureDto = {
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
  job_executions: WorkflowJobExecutionFixtureDto[];
};

type WorkflowRunFixtureDto = Omit<
  WorkflowRunResponseDto,
  'trigger_payload' | 'inputs' | 'source_snapshot'
> & {
  run_attempt: WorkflowRunAttemptDto;
  jobs: WorkflowJobFixtureDto[];
  has_started_job_execution: boolean;
};

type WorkflowRunTreeFixture = WorkflowRun & {
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  jobs: Job[];
  hasStartedJobExecution: boolean;
};

export type JobDtoOverrides = Partial<Omit<WorkflowJobFixtureDto, 'job_executions'>> & {
  job_executions?: WorkflowJobExecutionFixtureDto[];
  steps?: WorkflowStepFixtureDto[];
};

type JobDtoBase = Omit<WorkflowJobFixtureDto, 'job_executions'>;

// Built as the bounded run-list shape shared by list and overview fixture builders.
export function workflowRunDto(
  overrides: Partial<WorkflowRunListItemDto> = {},
): WorkflowRunListItemDto {
  return {
    id: RUN_ID,
    project_id: PROJECT_ID,
    definition_id: DEFINITION_ID,
    number: 1,
    name: 'deploy-web',
    workflow_name: 'deploy-web',
    status: 'running',
    origin: 'synced',
    dev_source: null,
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: null,
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_reference: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    started_at: null,
    finished_at: null,
    jobs: [],
    job_status_counts: [],
    job_display_status_counts: [],
    has_started_job_execution: false,
    ...overrides,
  };
}

/** A mutation response retains write-owned fields that run-list rows omit. */
export function workflowRunResponseDto(
  overrides: Partial<WorkflowRunResponseDto> = {},
): WorkflowRunResponseDto {
  const {
    trigger_payload: triggerPayload = {},
    inputs = null,
    source_snapshot: sourceSnapshot = null,
    ...runOverrides
  } = overrides;
  return {
    ...workflowRunDto(runOverrides as Partial<WorkflowRunListItemDto>),
    trigger_payload: triggerPayload,
    inputs,
    source_snapshot: sourceSnapshot,
  };
}

export function workflowRunJobSummaryDto(
  overrides: Partial<WorkflowRunJobSummaryDto> = {},
): WorkflowRunJobSummaryDto {
  jobSummarySequence += 1;
  const status = overrides.status ?? 'succeeded';
  return {
    id: `${JOB_SUMMARY_ID_PREFIX}${String(jobSummarySequence).padStart(11, '0')}`,
    key: `job-${jobSummarySequence}`,
    name: null,
    status,
    mode: 'one_shot',
    listener_status: 'inactive',
    execution_status: executionStatusForFixtureStatus(status),
    position: jobSummarySequence - 1,
    ...overrides,
  };
}

/** A strip of `count` job glyphs, with `statuses` applied from the left. */
export function workflowRunJobSummaryDtos(
  count: number,
  statuses: readonly JobStatusDto[] = [],
): WorkflowRunJobSummaryDto[] {
  return Array.from({length: count}, (_, index) => {
    const status = statuses[index];
    return workflowRunJobSummaryDto({
      key: `job-${index + 1}`,
      position: index,
      ...(status
        ? {
            status,
            execution_status: executionStatusForFixtureStatus(status),
          }
        : {}),
    });
  });
}

function executionStatusForFixtureStatus(
  status: JobStatusDto,
): WorkflowRunJobSummaryDto['execution_status'] {
  return status === 'pending' || status === 'running' ? status : null;
}

/**
 * A run's jobs as the API sends them: the preview truncated at the server's bound, and counts
 * over every status given.
 *
 * Built from one list so the two can never disagree. A fixture whose counts contradicted its
 * preview would hide exactly the bug the split exists to prevent.
 *
 * `has_started_job_execution` follows the statuses where they settle it: `succeeded` and `failed`
 * cannot be reached without running. `pending`, `skipped`, and `cancelled` leave it open, which is
 * the ambiguity the server flag exists to resolve, so those default to not started and a case that
 * needs the other reading overrides it.
 */
export function workflowRunJobsFixture(
  statuses: readonly JobStatusDto[],
): Pick<
  WorkflowRunListItemDto,
  'jobs' | 'job_status_counts' | 'job_display_status_counts' | 'has_started_job_execution'
> {
  const counts = new Map<JobStatusDto, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);

  const preview = workflowRunJobSummaryDtos(
    Math.min(statuses.length, WORKFLOW_RUN_JOB_PREVIEW_LIMIT),
    statuses,
  );

  return {
    jobs: preview,
    job_status_counts: [...counts.entries()].map(([status, count]) => ({status, count})),
    job_display_status_counts: [...counts.entries()].map(([status, count]) => ({status, count})),
    has_started_job_execution: statuses.some(
      (status) => status === 'running' || status === 'succeeded' || status === 'failed',
    ),
  };
}

/** `count` jobs that all share one status, for density cases where the mix does not matter. */
export function workflowRunJobsOfStatus(
  count: number,
  status: JobStatusDto = 'succeeded',
): Pick<
  WorkflowRunListItemDto,
  'jobs' | 'job_status_counts' | 'job_display_status_counts' | 'has_started_job_execution'
> {
  return workflowRunJobsFixture(Array.from({length: count}, () => status));
}

export function workflowRunListItem(
  overrides: Partial<WorkflowRunListItemDto> = {},
): WorkflowRunListItem {
  return toWorkflowRunListItem(workflowRunDto(overrides));
}

export function workflowRunListResponseDto(
  overrides: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListResponseDto {
  return {
    runs: [workflowRunDto()],
    next_cursor: null,
    filtered_total_count: 1,
    ...overrides,
  };
}

export function workflowRunListPage(
  overrides: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListPage {
  return toWorkflowRunListPage(workflowRunListResponseDto(overrides));
}

export function workflowRunFixtureDto(
  overrides: Partial<WorkflowRunFixtureDto> = {},
): WorkflowRunFixtureDto {
  const {
    jobs,
    run_attempt: runAttemptOverride,
    has_started_job_execution: hasStartedOverride,
    ...runOverrides
  } = overrides;
  const run = workflowRunDto(runOverrides);

  return {
    ...run,
    latest_attempt: run.latest_attempt,
    run_attempt:
      runAttemptOverride ??
      workflowRunAttemptDto({
        workflow_run_id: run.id,
        attempt: run.current_attempt,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
      }),
    jobs: jobs ?? [],
    // Follows the executions the case actually built, so the fixture cannot claim a run started
    // while carrying no execution that did.
    has_started_job_execution:
      hasStartedOverride ??
      (jobs ?? []).some((job) =>
        job.job_executions.some((execution) => execution.started_at != null),
      ),
  };
}

export function workflowRunOverviewResponseDto(
  detail: WorkflowRunFixtureDto,
): WorkflowRunOverviewResponseDto {
  return {
    run: {
      id: detail.id,
      project_id: detail.project_id,
      definition_id: detail.definition_id,
      number: detail.number,
      name: detail.name,
      workflow_name: detail.workflow_name,
      origin: detail.origin,
      dev_source: detail.dev_source,
      trigger_provider: detail.trigger_provider,
      trigger_source: detail.trigger_source,
      trigger_event: detail.trigger_event,
      trigger_reference: detail.trigger_reference,
      created_at: detail.created_at,
    },
    attempt: detail.run_attempt,
    has_started_job_execution: detail.has_started_job_execution,
    jobs: {
      kind: 'complete',
      total: detail.jobs.length,
      items: detail.jobs.map((job) => workflowJobOverviewDto(job, defaultJobExecutionDto(job))),
    },
  };
}

export function workflowRunOverview(
  overrides: Partial<WorkflowRunFixtureDto> = {},
): ReturnType<typeof toWorkflowRunOverview> {
  const detail = workflowRunFixtureDto(overrides);
  const overview = toWorkflowRunOverview(workflowRunOverviewResponseDto(detail));
  return {
    ...overview,
    currentAttempt: detail.current_attempt,
    latestAttempt: detail.latest_attempt,
  };
}

export function workflowRunTreeFixture(
  overrides: Partial<WorkflowRunFixtureDto> = {},
): WorkflowRunTreeFixture {
  const detail = workflowRunFixtureDto(overrides);
  const jobs = detail.jobs.map(toFixtureJob);
  return {
    id: detail.id,
    projectId: detail.project_id,
    definitionId: detail.definition_id,
    origin: detail.origin,
    devSource: detail.dev_source
      ? {
          ref: detail.dev_source.ref,
          commit: detail.dev_source.commit,
          configPath: detail.dev_source.config_path,
          initiatedByUserId: detail.dev_source.initiated_by_user_id,
          replayOfEventId: detail.dev_source.replay_of_event_id,
        }
      : null,
    number: detail.number,
    name: detail.name,
    workflowName: detail.workflow_name,
    currentAttempt: detail.current_attempt,
    triggerProvider: detail.trigger_provider,
    triggerSource: detail.trigger_source,
    triggerEvent: detail.trigger_event,
    triggerDisplayLabel: detail.trigger_event || detail.trigger_source,
    triggerLabel: [detail.trigger_source, detail.trigger_event].filter(Boolean).join(' · '),
    triggerReference: detail.trigger_reference,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
    isTemporary: detail.id.startsWith('temp-'),
    latestAttempt: detail.latest_attempt,
    runAttempt: toFixtureRunAttempt(detail.run_attempt),
    jobs,
    hasStartedJobExecution: detail.has_started_job_execution,
  };
}

/** Convert a run fixture into the selected-job response used by the migrated client. */
export function workflowJobDetailResponseDto({
  detail,
  jobId,
  executionId,
}: {
  detail: WorkflowRunFixtureDto;
  jobId: string;
  executionId?: string | null | undefined;
}): WorkflowJobDetailDto {
  const job = detail.jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error(`Fixture is missing job ${jobId}`);

  const defaultExecution = defaultJobExecutionDto(job);
  const selectedExecution =
    executionId === null
      ? undefined
      : (job.job_executions.find((candidate) => candidate.id === executionId) ?? defaultExecution);

  return {
    workflow_run_id: detail.id,
    workflow_run_attempt: detail.run_attempt.attempt,
    job: workflowJobOverviewDto(job, defaultExecution),
    selected_execution: selectedExecution ? compactJobExecutionDto(job, selectedExecution) : null,
  };
}

function workflowJobOverviewDto(
  job: WorkflowJobFixtureDto,
  defaultExecution: WorkflowJobExecutionFixtureDto | undefined,
): WorkflowRunJobOverviewDto {
  const executionStatusCounts: Record<WorkflowJobExecutionFixtureDto['status'], number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const execution of job.job_executions) executionStatusCounts[execution.status] += 1;

  return {
    id: job.id,
    key: job.key,
    name: job.name,
    position: job.position,
    dependencies: job.dependencies,
    status: job.status,
    status_reason: job.status_reason,
    mode: job.mode,
    listener_status: job.listener_status,
    carried_over: job.carried_over,
    execution_count: job.job_executions.length,
    execution_status_counts: executionStatusCounts,
    default_execution: defaultExecution ? jobExecutionSummaryDto(defaultExecution) : null,
  };
}

export function workflowRunOverviewJob(overrides: JobDtoOverrides = {}): WorkflowRunOverviewJob {
  const job = workflowJobDto(
    overrides.status === 'running' &&
      overrides.mode !== 'listening' &&
      !overrides.job_executions &&
      !overrides.steps
      ? {...overrides, job_executions: [workflowJobExecutionDto({status: 'running'})]}
      : overrides,
  );
  return toWorkflowRunOverviewJob(workflowJobOverviewDto(job, defaultJobExecutionDto(job)));
}

function defaultJobExecutionDto(
  job: WorkflowJobFixtureDto,
): WorkflowJobExecutionFixtureDto | undefined {
  return (
    job.job_executions.find((execution) => execution.status === 'running') ??
    job.job_executions.reduce<WorkflowJobExecutionFixtureDto | undefined>(
      (latest, execution) => (!latest || execution.sequence > latest.sequence ? execution : latest),
      undefined,
    )
  );
}

function jobExecutionSummaryDto(execution: WorkflowJobExecutionFixtureDto): JobExecutionSummaryDto {
  return {
    id: execution.id,
    sequence: execution.sequence,
    name: execution.name,
    status: execution.status,
    display_status: execution.status,
    status_reason: execution.status_reason as JobExecutionSummaryDto['status_reason'],
    status_reason_message: execution.status_reason_message ?? null,
    queued_at: execution.queued_at,
    started_at: execution.started_at,
    finished_at: execution.finished_at,
    timed_out_at: execution.timed_out_at,
    updated_at: execution.updated_at,
  };
}

function compactJobExecutionDto(
  job: WorkflowJobFixtureDto,
  execution: WorkflowJobExecutionFixtureDto,
): NonNullable<WorkflowJobDetailDto['selected_execution']> {
  return {
    ...jobExecutionSummaryDto(execution),
    has_context: Boolean(
      job.runner?.length ||
        Object.keys(job.outputs ?? {}).length > 0 ||
        job.evaluation_trace?.length ||
        job.success ||
        execution.runner?.length ||
        Object.keys(execution.outputs ?? {}).length > 0 ||
        execution.trigger_events.length ||
        execution.evaluation_trace?.length,
    ),
    steps: {
      items: execution.steps.map((step) => ({
        id: step.id,
        key: step.key,
        name: step.name,
        type: compactStepType(step.type),
        position: step.position,
        status: compactStepStatus(step.status),
        status_reason: step.status_reason,
        source_location: step.source_location,
        current_attempt: step.current_attempt,
        error: step.error,
        attempts: {
          items: step.attempts.map((attempt) => ({
            id: attempt.id,
            attempt: attempt.attempt,
            execution_order: attempt.execution_order,
            status: compactStepStatus(attempt.status),
            exit_code: attempt.exit_code,
            started_at: attempt.started_at,
            finished_at: attempt.finished_at,
            error: compactAttemptError(attempt.error),
            gate_result: compactGateResult(attempt.gate_result),
          })),
          next_cursor: null,
          total: step.attempts.length,
        },
      })),
      next_cursor: null,
      total: execution.steps.length,
    },
  };
}

function compactStepStatus(
  status: string,
): 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' {
  if (
    status === 'pending' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'skipped'
  ) {
    return status;
  }
  return 'pending';
}

function compactStepType(status: string): 'setup' | 'run' | 'agent' | 'checkout' | 'tool' {
  if (
    status === 'setup' ||
    status === 'run' ||
    status === 'agent' ||
    status === 'checkout' ||
    status === 'tool'
  ) {
    return status;
  }
  return 'run';
}

function compactAttemptError(error: Record<string, unknown> | null): StepErrorDto {
  if (!error || typeof error.message !== 'string') return null;
  return {message: error.message};
}

function compactGateResult(
  gateResult: WorkflowJobExecutionFixtureDto['steps'][number]['attempts'][number]['gate_result'],
): StepGateResultSummaryDto {
  if (!gateResult || typeof gateResult.kind !== 'string') return {kind: 'unknown'};
  if (gateResult.kind === 'none' || gateResult.kind === 'not_evaluated') {
    return {kind: gateResult.kind};
  }
  return {kind: 'unknown'};
}

function toFixtureRunAttempt(dto: WorkflowRunAttemptDto): WorkflowRunAttempt {
  return new WorkflowRunAttempt({
    id: dto.id,
    workflowRunId: dto.workflow_run_id,
    attempt: dto.attempt,
    status: dto.status,
    createdAt: dto.created_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    rerunMode: dto.rerun_mode,
  });
}

function toFixtureJob(dto: WorkflowJobFixtureDto): Job {
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
    listening: dto.listening ? toFixtureListening(dto.listening) : null,
    listenerStatus: dto.listener_status,
    resolutionReason: dto.resolution_reason,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    jobExecutions: dto.job_executions.map(toFixtureJobExecution),
  });
}

function toFixtureListening(dto: JobListeningDto) {
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

function toFixtureJobExecution(dto: WorkflowJobExecutionFixtureDto) {
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
    steps: dto.steps.map(toFixtureStep),
  });
}

function toFixtureStep(dto: WorkflowStepFixtureDto): Step {
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
    agentConfig: toFixtureAgentConfig(dto),
    toolConfig: toFixtureToolConfig(dto),
    error: toFixtureError(dto.error),
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) => toFixtureStepAttempt(attempt, dto.job_execution_id)),
  };
}

function toFixtureStepAttempt(dto: StepAttemptDto, jobExecutionId: string): StepAttempt {
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
    gateResult: toFixtureGateResult(dto.gate_result),
    restartFeedback: dto.restart_feedback,
    invocations: dto.invocations.map((invocation) => ({
      callIndex: invocation.call_index,
      startedAt: invocation.started_at,
      ...(invocation.finished_at === undefined ? {} : {finishedAt: invocation.finished_at}),
      ...(invocation.outcome === undefined ? {} : {outcome: invocation.outcome}),
      ...(invocation.error_code === undefined ? {} : {errorCode: invocation.error_code}),
      ...(invocation.duration_ms === undefined ? {} : {durationMs: invocation.duration_ms}),
      ...(invocation.next_due_at === undefined ? {} : {nextDueAt: invocation.next_due_at}),
    })),
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
  });
}

function toFixtureError(error: StepErrorDto): Step['error'] {
  if (error === null) return null;
  return {
    message: error.message,
    ...(error.code === undefined ? {} : {code: error.code}),
    ...(error.managed_provider_id === undefined
      ? {}
      : {managedProviderId: error.managed_provider_id}),
    ...(error.field === undefined ? {} : {field: error.field}),
    ...(error.source === undefined ? {} : {source: error.source}),
    exitCode: error.exit_code ?? null,
    signal: error.signal,
    reason: error.reason,
    agentConfigIssue: error.agent_config_issue,
    category: error.category,
  };
}

function toFixtureGateResult(gateResult: StepAttemptDto['gate_result']): StepAttempt['gateResult'] {
  if (gateResult === null) return null;
  if (gateResult.kind === 'none' || gateResult.kind === 'not_evaluated') return gateResult;
  if (gateResult.kind === 'passed') {
    return {
      kind: 'passed',
      passed: true,
      source: gateResult.source,
      exitCode: gateResult.exit_code,
    };
  }
  if (gateResult.kind === 'failed') {
    return {
      kind: 'failed',
      passed: false,
      source: gateResult.source,
      exitCode: gateResult.exit_code,
    };
  }
  if (gateResult.kind === 'uncheckable') {
    return {
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: gateResult.reason,
      exitCode: gateResult.exit_code,
    };
  }
  if (gateResult.kind === 'evaluation_error') {
    return {kind: 'evaluation_error', reason: gateResult.reason, exitCode: gateResult.exit_code};
  }
  return gateResult;
}

function toFixtureAgentConfig(dto: WorkflowStepFixtureDto): Step['agentConfig'] {
  if (dto.type !== 'agent') return null;
  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function toFixtureToolConfig(dto: WorkflowStepFixtureDto): Step['toolConfig'] {
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

function recordConfigValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringConfigValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function workflowRunAttemptDto(
  overrides: Partial<WorkflowRunAttemptDto> = {},
): WorkflowRunAttemptDto {
  return {
    id: RUN_ATTEMPT_ID,
    workflow_run_id: RUN_ID,
    attempt: 1,
    status: 'running',
    created_at: '2026-06-21T12:00:00.000Z',
    started_at: null,
    finished_at: null,
    rerun_mode: null,
    ...overrides,
  };
}

export function runAttemptsResponseDto(
  overrides: Partial<WorkflowRunAttemptsResponseDto> = {},
): WorkflowRunAttemptsResponseDto {
  return {
    items: [workflowRunAttemptDto()],
    next_cursor: null,
    ...overrides,
  };
}

export function workflowJobDto(overrides: JobDtoOverrides = {}): WorkflowJobFixtureDto {
  jobSequence += 1;
  const {job_executions, steps, ...jobOverrides} = overrides;
  const key =
    jobOverrides.key ?? (typeof jobOverrides.name === 'string' ? jobOverrides.name : 'build');
  const job: JobDtoBase = {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_attempt_id: RUN_ID,
    key,
    name: null,
    mode: 'one_shot',
    status: 'pending',
    status_reason: null,
    carried_over: false,
    success: null,
    runner: null,
    evaluation_trace: null,
    listening: null,
    listener_status: 'inactive',
    resolution_reason: null,
    outputs: null,
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    ...jobOverrides,
  };

  return {
    ...job,
    job_executions:
      job_executions ?? (steps ? [workflowJobExecutionDto({job_id: job.id, steps})] : []),
  };
}

export function workflowJob(overrides: JobDtoOverrides = {}): Job {
  return toFixtureJob(workflowJobDto(overrides));
}

export function workflowJobExecutionDto(
  overrides: Partial<WorkflowJobExecutionFixtureDto> = {},
): WorkflowJobExecutionFixtureDto {
  jobExecutionSequence += 1;
  const id =
    overrides.id ?? `77777777-7777-4777-8777-${String(jobExecutionSequence).padStart(12, '0')}`;
  const {
    steps: overrideSteps,
    status_reason_message: statusReasonMessage,
    ...restOverrides
  } = overrides;
  const steps = overrideSteps?.map((step) => ({...step, job_execution_id: id})) ?? [];

  return {
    id,
    job_id: JOB_ID,
    sequence: 1,
    name: 'build',
    status: 'pending',
    status_reason: null,
    runner: null,
    trigger_events: [],
    outputs: null,
    evaluation_trace: null,
    queued_at: null,
    started_at: null,
    finished_at: null,
    timed_out_at: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    steps,
    ...restOverrides,
    status_reason_message: statusReasonMessage ?? null,
  };
}

export function workflowStepDto(
  overrides: Partial<WorkflowStepFixtureDto> = {},
): WorkflowStepFixtureDto {
  stepSequence += 1;

  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_execution_id: JOB_EXECUTION_ID,
    key: 'build',
    name: 'build',
    source_location: null,
    status: 'pending',
    status_reason: null,
    type: 'run',
    config: {},
    evaluation_trace: null,
    error: null,
    session: null,
    position: 0,
    current_attempt: 1,
    exit_code: null,
    outputs: null,
    response: null,
    gate_result: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

export function workflowStep(overrides: Partial<WorkflowStepFixtureDto> = {}): Step {
  return toFixtureStep(workflowStepDto(overrides));
}

export function workflowStepAttemptDto(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: STEP_ID,
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    outputs: null,
    response: null,
    error: null,
    gate_result: null,
    restart_feedback: null,
    invocations: [],
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}

export function workflowStepAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttempt {
  return toFixtureStepAttempt(workflowStepAttemptDto(overrides), JOB_EXECUTION_ID);
}

export function sequencedWorkflowRunDto(
  status: WorkflowRunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<WorkflowRunListItemDto> = {},
): WorkflowRunListItemDto {
  runSequence += 1;
  return workflowRunDto({
    id: `run-${String(runSequence).padStart(8, '0')}`,
    project_id: 'proj-demo',
    definition_id: 'def-demo',
    name,
    status,
    trigger_provider: status === 'pending' ? null : 'github',
    trigger_source: status === 'pending' ? '' : 'github_acme',
    trigger_event: status === 'pending' ? '' : 'push',
    created_at: new Date(Date.now() - minutesAgo * 120_000).toISOString(),
    updated_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ...overrides,
  });
}

export function sequencedWorkflowRunListItem(
  status: WorkflowRunStatusDto,
  name: string,
  minutesAgo: number,
  overrides: Partial<WorkflowRunListItemDto> = {},
): WorkflowRunListItem {
  return toWorkflowRunListItem(sequencedWorkflowRunDto(status, name, minutesAgo, overrides));
}

export function workflowJobWithName(
  name: string,
  overrides: JobDtoOverrides = {},
): WorkflowJobFixtureDto {
  return workflowJobDto({name, ...overrides});
}

export type {JobStatusDto, WorkflowRunStatusDto};
