import type {
  EvaluationTraceDto,
  JobListeningDto,
  StepAttemptDetailResponseDto,
  StepAttemptDto,
  StepGateResultDto,
  WorkflowExecutionEventDto,
  WorkflowRunAttemptDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunJobListSummaryDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunLineageHeadResponseDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunSelectionResponseDto,
  WorkflowRunSourceResponseDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {
  deriveStepErrorCategory,
  WORKFLOW_RUN_OVERVIEW_COMPLETE_EDGE_LIMIT,
  WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT,
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
} from '@shipfox/api-workflows-dto';
import {
  AGENT_CONFIG_ISSUES,
  defaultJobExecution,
  deriveJobExecutionDisplayStatus,
  type EvaluationTraceEntry,
  Job,
  JobExecution,
  type JobListening,
  type JobStatus,
  STEP_ERROR_REASONS,
  type Step,
  StepAttempt,
  type StepAttemptSession,
  type StepError,
  type StepGateResult,
  toWorkflowRunOverviewExecutionDuration,
  type WorkflowExecutionEvent,
  type WorkflowRun,
  WorkflowRunAttempt,
  WorkflowRunAttemptSummary,
  type WorkflowRunDetail,
  type WorkflowRunDevSource,
  type WorkflowRunLineageHead,
  type WorkflowRunListItem,
  type WorkflowRunListPage,
  type WorkflowRunOverview,
  type WorkflowRunOverviewExecution,
  WorkflowRunOverviewJob,
  type WorkflowRunOverviewJobPage,
  type WorkflowRunOverviewJobs,
  type WorkflowRunRecord,
  type WorkflowRunSelectionResolution,
  type WorkflowRunSource,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from '#core/workflow-run.js';
import {toWorkflowDiagnosticUnavailableField} from './workflow-diagnostic-mapper.js';

const BASE64_URL_PADDING_RE = /=+$/u;
const BASE64_URL_VALUE_RE = /^[A-Za-z0-9_-]+$/u;

export function toWorkflowRun(dto: WorkflowRunResponseDto): WorkflowRun {
  return {
    id: dto.id,
    projectId: dto.project_id,
    definitionId: dto.definition_id,
    // The API defaults these during rollout, but older responses predate the fields; mirror
    // the DTO defaults so every consumer reads a fully-populated model.
    origin: dto.origin ?? 'synced',
    devSource: toDevSource(dto.dev_source),
    number: dto.number,
    name: dto.name,
    workflowName: dto.workflow_name,
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
    triggerReference: dto.trigger_reference,
    inputs: dto.inputs ?? null,
    sourceSnapshot: dto.source_snapshot
      ? {content: dto.source_snapshot.content, format: dto.source_snapshot.format}
      : null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    isTemporary: dto.id.startsWith('temp-'),
  };
}

function toDevSource(devSource: WorkflowRunResponseDto['dev_source']): WorkflowRunDevSource | null {
  if (!devSource) return null;
  return {
    ref: devSource.ref,
    commit: devSource.commit,
    configPath: devSource.config_path,
    initiatedByUserId: devSource.initiated_by_user_id,
    replayOfEventId: devSource.replay_of_event_id,
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

export function toWorkflowRunLineageHead(
  dto: WorkflowRunLineageHeadResponseDto,
): WorkflowRunLineageHead {
  return {
    currentAttempt: dto.current_attempt,
    latestAttempt: dto.latest_attempt,
    currentStatus: dto.current_status,
    updatedAt: dto.updated_at,
  };
}

export function toWorkflowRunLineageHeadFromRecord(
  run: Pick<WorkflowRunRecord, 'currentAttempt' | 'latestAttempt' | 'status' | 'updatedAt'>,
): WorkflowRunLineageHead {
  return {
    currentAttempt: run.currentAttempt,
    latestAttempt: run.latestAttempt,
    currentStatus: run.status,
    updatedAt: run.updatedAt,
  };
}

export function toWorkflowRunSource(dto: WorkflowRunSourceResponseDto): WorkflowRunSource {
  const identity = {
    workflowRunId: dto.workflow_run_id,
    workflowRunAttempt: dto.workflow_run_attempt,
  };
  if (dto.kind === 'unavailable') {
    return {...identity, kind: 'unavailable', reason: dto.reason};
  }
  return {
    ...identity,
    kind: 'available',
    sourceSnapshot: {content: dto.source_snapshot.content, format: dto.source_snapshot.format},
  };
}

export function toWorkflowRunOverview(dto: WorkflowRunOverviewResponseDto): WorkflowRunOverview {
  const attempt = toWorkflowRunAttempt(dto.attempt);
  return {
    id: dto.run.id,
    projectId: dto.run.project_id,
    definitionId: dto.run.definition_id,
    number: dto.run.number,
    name: dto.run.name,
    workflowName: dto.run.workflow_name,
    origin: dto.run.origin,
    devSource: toDevSource(dto.run.dev_source),
    triggerProvider: dto.run.trigger_provider,
    triggerSource: dto.run.trigger_source,
    triggerEvent: dto.run.trigger_event,
    triggerDisplayLabel: workflowRunTriggerDisplayLabel({
      triggerSource: dto.run.trigger_source,
      triggerEvent: dto.run.trigger_event,
    }),
    triggerLabel: workflowRunTriggerLabel({
      triggerSource: dto.run.trigger_source,
      triggerEvent: dto.run.trigger_event,
    }),
    triggerReference: dto.run.trigger_reference,
    createdAt: dto.run.created_at,
    currentAttempt: attempt.attempt,
    latestAttempt: attempt.attempt,
    runAttempt: attempt,
    hasStartedJobExecution: dto.has_started_job_execution,
    jobs: toWorkflowRunOverviewJobs(dto.jobs),
  };
}

export function toWorkflowRunOverviewJobs(
  dto: WorkflowRunOverviewResponseDto['jobs'],
): WorkflowRunOverviewJobs {
  if (dto.kind === 'complete') {
    return {
      kind: 'complete',
      total: dto.total,
      items: dto.items.map(toWorkflowRunOverviewJob),
    };
  }

  return {
    kind: 'large',
    total: dto.total,
    statusCounts: dto.status_counts.map(({status, count}) => ({status, count})),
    firstPage: {
      items: dto.first_page.items.map(toWorkflowRunOverviewJob),
      nextCursor: dto.first_page.next_cursor,
      total: dto.first_page.total,
    },
  };
}

export function toWorkflowRunOverviewJob(
  dto: WorkflowRunJobOverviewDto | WorkflowRunJobListSummaryDto,
): WorkflowRunOverviewJob {
  const defaultExecution = dto.default_execution
    ? toWorkflowRunOverviewExecution(dto.default_execution)
    : null;
  return new WorkflowRunOverviewJob({
    id: dto.id,
    key: dto.key,
    name: dto.name,
    position: dto.position,
    dependencies: 'dependencies' in dto ? dto.dependencies : [],
    status: dto.status,
    statusReason: dto.status_reason,
    mode: dto.mode,
    listenerStatus: dto.listener_status,
    carriedOver: dto.carried_over,
    executionCount: dto.execution_count,
    executionStatusCounts: {
      pending: dto.execution_status_counts.pending,
      running: dto.execution_status_counts.running,
      succeeded: dto.execution_status_counts.succeeded,
      failed: dto.execution_status_counts.failed,
      cancelled: dto.execution_status_counts.cancelled,
    },
    defaultExecution,
  });
}

export function toWorkflowRunOverviewExecution(
  dto: NonNullable<WorkflowRunJobOverviewDto['default_execution']>,
): WorkflowRunOverviewExecution {
  return {
    id: dto.id,
    sequence: dto.sequence,
    name: dto.name,
    status: dto.status,
    displayStatus: dto.display_status,
    statusReason: dto.status_reason,
    statusReasonMessage: dto.status_reason_message,
    queuedAt: dto.queued_at,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at,
    timedOutAt: dto.timed_out_at,
    updatedAt: dto.updated_at,
    displayDuration: toWorkflowRunOverviewExecutionDuration({
      queuedAt: dto.queued_at,
      startedAt: dto.started_at,
      finishedAt: dto.finished_at,
    }),
  };
}

export function toWorkflowRunOverviewJobPage(dto: {
  items: WorkflowRunJobListSummaryDto[];
  next_cursor: string | null;
  total?: number | undefined;
}): WorkflowRunOverviewJobPage {
  return {
    items: dto.items.map(toWorkflowRunOverviewJob),
    nextCursor: dto.next_cursor,
    ...(dto.total === undefined ? {} : {total: dto.total}),
  };
}

export function toWorkflowRunSelectionResolution(
  dto: WorkflowRunSelectionResponseDto,
): WorkflowRunSelectionResolution {
  return {
    workflowRunId: dto.workflow_run_id,
    workflowRunAttempt: dto.workflow_run_attempt,
    jobId: dto.job_id,
    jobExecutionId: dto.job_execution_id,
    stepId: dto.step_id,
    stepAttemptId: dto.step_attempt_id,
    stepAttempt: dto.step_attempt,
    sourceLocation: dto.source_location
      ? {startLine: dto.source_location.start_line, endLine: dto.source_location.end_line}
      : null,
  };
}

export function toWorkflowRunRecord(dto: WorkflowRunResponseDto): WorkflowRunRecord {
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

export function toWorkflowRunListItem(dto: WorkflowRunListItemDto): WorkflowRunListItem {
  const hasDisplayStatusCounts = dto.job_display_status_counts !== undefined;
  const statusCounts = (dto.job_display_status_counts ?? dto.job_status_counts).map(
    ({status, count}) => ({status, count}),
  );
  return {
    ...toWorkflowRunRecord(dto),
    jobs: {
      preview: dto.jobs.map((job) => ({
        id: job.id,
        key: job.key,
        name: job.name,
        status: job.status,
        mode: job.mode ?? 'one_shot',
        listenerStatus: job.listener_status ?? 'inactive',
        // The optional display-count field is the rollout capability signal. Pre-display API
        // responses only carry raw verdict counts, so mirror their non-terminal verdict into
        // execution evidence to keep each legacy glyph aligned with those fallback counts.
        executionStatus: hasDisplayStatusCounts
          ? (job.execution_status ?? null)
          : legacyExecutionStatus(job.status),
        position: job.position,
      })),
      statusCounts,
      hasStartedJobExecution: dto.has_started_job_execution ?? true,
      // Derived rather than sent: the counts already cover every job, and a separate total
      // would be a second source of truth that could disagree with them.
      total: statusCounts.reduce((sum, entry) => sum + entry.count, 0),
    },
  };
}

function legacyExecutionStatus(
  status: WorkflowRunListItemDto['jobs'][number]['status'],
): 'pending' | 'running' | null {
  return status === 'pending' || status === 'running' ? status : null;
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
    hasStartedJobExecution: dto.has_started_job_execution ?? true,
  };
}

/**
 * Converts the retained tree response into the bounded shape while an older API is still in
 * service. The normal workspace path never calls this for a valid overview response; it exists
 * solely so a mixed deployment can keep the shell usable until the overview route is available.
 */
export function toWorkflowRunOverviewFromDetail(
  dto: WorkflowRunDetailResponseDto,
): WorkflowRunOverview {
  return toWorkflowRunOverviewFromRunDetail(toWorkflowRunDetail(dto));
}

export function toWorkflowRunOverviewFromRunDetail(detail: WorkflowRunDetail): WorkflowRunOverview {
  const items = detail.jobs.map(toWorkflowRunOverviewJobFromDetail);
  const totalDependencyEdges = detail.jobs.reduce(
    (total, job) => total + job.dependencies.length,
    0,
  );
  const header = {
    id: detail.id,
    projectId: detail.projectId,
    definitionId: detail.definitionId,
    number: detail.number,
    name: detail.name,
    workflowName: detail.workflowName,
    origin: detail.origin,
    devSource: detail.devSource,
    triggerProvider: detail.triggerProvider,
    triggerSource: detail.triggerSource,
    triggerEvent: detail.triggerEvent,
    triggerDisplayLabel: detail.triggerDisplayLabel,
    triggerLabel: detail.triggerLabel,
    triggerReference: detail.triggerReference,
    createdAt: detail.createdAt,
    currentAttempt: detail.currentAttempt,
    latestAttempt: detail.latestAttempt,
    runAttempt: detail.runAttempt,
    hasStartedJobExecution: detail.hasStartedJobExecution,
  };
  if (
    items.length <= WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT &&
    totalDependencyEdges <= WORKFLOW_RUN_OVERVIEW_COMPLETE_EDGE_LIMIT
  ) {
    return {
      ...header,
      jobs: {kind: 'complete', total: items.length, items},
    };
  }

  const counts = new Map<JobStatus, number>();
  for (const job of detail.jobs) {
    counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
  }

  const firstPage = toWorkflowRunOverviewJobsPageFromRunDetail(detail);
  return {
    ...header,
    jobs: {
      kind: 'large',
      total: items.length,
      statusCounts: [...counts].map(([status, count]) => ({status, count})),
      firstPage: {...firstPage, total: items.length},
    },
  };
}

const LEGACY_WORKFLOW_RUN_OVERVIEW_JOBS_CURSOR_KIND = 'legacy-workflow-run-overview-jobs';

export function legacyWorkflowRunOverviewJobsCursor(offset: number): string {
  return encodeBase64UrlJson({
    kind: LEGACY_WORKFLOW_RUN_OVERVIEW_JOBS_CURSOR_KIND,
    offset,
  });
}

export function toWorkflowRunOverviewJobsPageFromRunDetail(
  detail: WorkflowRunDetail,
  offset = 0,
): WorkflowRunOverviewJobPage {
  const pageItems = detail.jobs
    .slice(offset, offset + WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT)
    .map(toWorkflowRunOverviewJobFromDetail)
    .map((item) => new WorkflowRunOverviewJob({...item, dependencies: []}));
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    nextCursor:
      nextOffset < detail.jobs.length ? legacyWorkflowRunOverviewJobsCursor(nextOffset) : null,
    total: detail.jobs.length,
  };
}

export function legacyWorkflowRunOverviewJobsOffset(cursor: string | null): number | undefined {
  if (!cursor) return 0;
  const decoded = decodeBase64UrlJson(cursor);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return undefined;
  const {kind, offset} = decoded as {kind?: unknown; offset?: unknown};
  return kind === LEGACY_WORKFLOW_RUN_OVERVIEW_JOBS_CURSOR_KIND &&
    typeof offset === 'number' &&
    Number.isSafeInteger(offset) &&
    offset >= 0
    ? offset
    : undefined;
}

function encodeBase64UrlJson(value: object): string {
  return btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(BASE64_URL_PADDING_RE, '');
}

function decodeBase64UrlJson(value: string): unknown {
  if (!BASE64_URL_VALUE_RE.test(value)) return undefined;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as unknown;
  } catch {
    return undefined;
  }
}

function toWorkflowRunOverviewJobFromDetail(job: Job): WorkflowRunOverviewJob {
  const executionStatusCounts = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  } as const;
  const counts = {...executionStatusCounts};
  for (const execution of job.jobExecutions) {
    counts[deriveJobExecutionDisplayStatus(execution)] += 1;
  }

  const execution = defaultJobExecution(job);
  return new WorkflowRunOverviewJob({
    id: job.id,
    key: job.key,
    name: job.name,
    position: job.position,
    dependencies: job.dependencies,
    status: job.status,
    statusReason: job.statusReason,
    mode: job.mode,
    listenerStatus: job.listenerStatus,
    carriedOver: job.carriedOver,
    executionCount: boundedExecutionCount(job.jobExecutions.length),
    executionStatusCounts: {
      pending: boundedExecutionCount(counts.pending),
      running: boundedExecutionCount(counts.running),
      succeeded: boundedExecutionCount(counts.succeeded),
      failed: boundedExecutionCount(counts.failed),
      cancelled: boundedExecutionCount(counts.cancelled),
    },
    defaultExecution: execution
      ? {
          id: execution.id,
          sequence: execution.sequence,
          name: execution.name,
          status: execution.status,
          displayStatus: deriveJobExecutionDisplayStatus(execution),
          statusReason: toJobStatusReason(execution.statusReason),
          statusReasonMessage: execution.statusReasonMessage,
          queuedAt: execution.queuedAt,
          startedAt: execution.startedAt,
          finishedAt: execution.finishedAt,
          timedOutAt: execution.timedOutAt,
          updatedAt: execution.updatedAt,
          displayDuration: execution.displayDuration,
        }
      : null,
  });
}

function boundedExecutionCount(count: number): number | '100+' {
  return count > 100 ? '100+' : count;
}

function toJobStatusReason(
  value: string | null,
):
  | 'dependency_not_completed'
  | 'condition_false'
  | 'default_gate_rejected'
  | 'condition_rejected'
  | 'condition_errored'
  | 'user_cancelled'
  | 'run_cancelled'
  | 'timed_out'
  | 'runner_lost'
  | 'output_too_large'
  | 'step_failed'
  | 'unknown'
  | 'output_invalid'
  | null {
  switch (value) {
    case 'dependency_not_completed':
    case 'condition_false':
    case 'default_gate_rejected':
    case 'condition_rejected':
    case 'condition_errored':
    case 'user_cancelled':
    case 'run_cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'output_too_large':
    case 'step_failed':
    case 'unknown':
    case 'output_invalid':
      return value;
    default:
      return value === null ? null : 'unknown';
  }
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
    outputs: dto.outputs ?? null,
    success: dto.success ?? null,
    runner: dto.runner ?? null,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
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
    statusReasonMessage: dto.status_reason_message ?? null,
    runner: dto.runner ?? null,
    outputs: dto.outputs ?? null,
    triggerEvents: (dto.trigger_events ?? []).map(toWorkflowExecutionEvent),
    queuedAt: dto.queued_at ?? null,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    timedOutAt: dto.timed_out_at ?? null,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
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
    statusReason: dto.status_reason,
    type: dto.type,
    config: dto.config,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    agentConfig: toAgentStepConfig(dto),
    toolConfig: toToolStepConfig(dto),
    error: toStepError(dto.error),
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) => toStepAttempt(attempt, dto.job_execution_id, dto.type)),
  };
}

function toStepError(error: WorkflowRunStepDetailDto['error']): StepError | null {
  if (!error) return null;
  return {
    message: error.message,
    ...(error.code === undefined ? {} : {code: error.code}),
    ...(error.managed_provider_id === undefined
      ? {}
      : {managedProviderId: error.managed_provider_id}),
    ...(error.field === undefined ? {} : {field: error.field}),
    ...(error.source === undefined ? {} : {source: error.source}),
    ...(error.retryable === undefined ? {} : {retryable: error.retryable}),
    ...toStepErrorSizeFields(error),
    exitCode: error.exit_code ?? null,
    signal: error.signal,
    reason: error.reason,
    agentConfigIssue: error.agent_config_issue,
    category: error.category,
  };
}

export function toStepAttempt(
  dto: StepAttemptDto,
  jobExecutionId: string,
  stepType = 'run',
): StepAttempt {
  return new StepAttempt({
    id: dto.id,
    stepId: dto.step_id,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
    outputs: dto.outputs ?? dto.output ?? null,
    response: dto.response ?? null,
    error: dto.error ?? null,
    stepError: toAttemptStepError(stepType, dto.error),
    gateResult: toStepGateResult(dto.gate_result),
    restartFeedback: dto.restart_feedback ?? null,
    invocations: dto.invocations.map(toStepAttemptInvocation),
    startedAt: dto.started_at,
    finishedAt: dto.finished_at ?? null,
  });
}

function toAttemptStepError(
  stepType: string,
  error: Record<string, unknown> | null | undefined,
): StepError | null {
  if (!error) return null;

  const parsedReason = parsedStepErrorReason(error.reason);
  const rawAgentConfigIssue = error.agentConfigIssue ?? error.agent_config_issue;
  const agentConfigIssue = parsedAgentConfigIssue(rawAgentConfigIssue);
  const reason = parsedReason ?? (agentConfigIssue ? 'agent_config_invalid' : undefined);

  const exitCode = error.exitCode ?? error.exit_code;
  const managedProviderId = selectedString(error, 'managedProviderId', 'managed_provider_id');
  const retryable = typeof error.retryable === 'boolean' ? error.retryable : undefined;

  return {
    message: typeof error.message === 'string' ? error.message : '',
    ...selectedStepErrorStringFields(error),
    ...toStepErrorSizeFields(error),
    ...(managedProviderId === undefined ? {} : {managedProviderId}),
    ...(retryable === undefined ? {} : {retryable}),
    exitCode: exitCode === null || typeof exitCode === 'number' ? exitCode : null,
    signal: typeof error.signal === 'string' ? error.signal : undefined,
    reason,
    agentConfigIssue,
    category: reason === undefined ? undefined : deriveStepErrorCategory(stepType, reason),
  };
}

interface StepErrorSizeSource {
  limitBytes?: unknown;
  limit_bytes?: unknown;
  measuredBytes?: unknown;
  measured_bytes?: unknown;
  overshootBytes?: unknown;
  overshoot_bytes?: unknown;
}

function toStepErrorSizeFields(
  error: StepErrorSizeSource,
): Pick<StepError, 'limitBytes' | 'measuredBytes' | 'overshootBytes'> {
  const limitBytes = selectedByteCount(error.limitBytes, error.limit_bytes);
  const measuredBytes = selectedByteCount(error.measuredBytes, error.measured_bytes);
  const overshootBytes = selectedByteCount(error.overshootBytes, error.overshoot_bytes);
  return {
    ...(limitBytes === undefined ? {} : {limitBytes}),
    ...(measuredBytes === undefined ? {} : {measuredBytes}),
    ...(overshootBytes === undefined ? {} : {overshootBytes}),
  };
}

function selectedByteCount(camelCaseValue: unknown, snakeCaseValue: unknown): number | undefined {
  const value = camelCaseValue ?? snakeCaseValue;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function selectedStepErrorStringFields(
  error: Record<string, unknown>,
): Pick<StepError, 'code' | 'field' | 'source'> {
  return {
    ...(typeof error.code === 'string' ? {code: error.code} : {}),
    ...(typeof error.field === 'string' ? {field: error.field} : {}),
    ...(typeof error.source === 'string' ? {source: error.source} : {}),
  };
}

function selectedString(
  error: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
): string | undefined {
  const value = error[camelCaseKey] ?? error[snakeCaseKey];
  return typeof value === 'string' ? value : undefined;
}

function parsedStepErrorReason(value: unknown): NonNullable<StepError['reason']> | undefined {
  if (typeof value !== 'string') return undefined;
  if (!STEP_ERROR_REASONS.has(value as StepError['reason'] & string)) return undefined;
  return value as NonNullable<StepError['reason']>;
}

function parsedAgentConfigIssue(
  value: unknown,
): NonNullable<StepError['agentConfigIssue']> | undefined {
  if (typeof value !== 'string') return undefined;
  if (!AGENT_CONFIG_ISSUES.has(value as NonNullable<StepError['agentConfigIssue']>)) {
    return undefined;
  }
  return value as NonNullable<StepError['agentConfigIssue']>;
}

export function toStepAttemptDetail(dto: StepAttemptDetailResponseDto) {
  const mappedSession: StepAttemptSession | null = dto.session
    ? {key: dto.session.key, mode: dto.session.mode, segment: dto.session.segment}
    : null;

  return {
    stepId: dto.step_id,
    attempt: dto.attempt,
    session: mappedSession,
    authoredConfig: dto.authored_config,
    config: dto.config,
    toolArguments: toolConfigValue(dto.config)?.with ?? null,
    evaluationTrace: toEvaluationTrace(dto.evaluation_trace),
    output: dto.output === undefined ? undefined : (dto.output ?? null),
    outputs: dto.outputs === undefined ? undefined : (dto.outputs ?? null),
    response: dto.response === undefined ? undefined : (dto.response ?? null),
    error: dto.error === undefined ? undefined : (dto.error ?? null),
    gateResult: dto.gate_result === undefined ? undefined : toStepGateResult(dto.gate_result),
    invocations: dto.invocations?.map(toStepAttemptInvocation),
    restartFeedback:
      dto.restart_feedback === undefined ? undefined : (dto.restart_feedback ?? null),
    oversizedFields: dto.oversized_fields?.map(toWorkflowDiagnosticUnavailableField),
  };
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

function toStepAttemptInvocation(invocation: StepAttemptDto['invocations'][number]) {
  return {
    callIndex: invocation.call_index,
    startedAt: invocation.started_at,
    ...(invocation.finished_at === undefined ? {} : {finishedAt: invocation.finished_at}),
    ...(invocation.outcome === undefined ? {} : {outcome: invocation.outcome}),
    ...(invocation.error_code === undefined ? {} : {errorCode: invocation.error_code}),
    ...(invocation.duration_ms === undefined ? {} : {durationMs: invocation.duration_ms}),
    ...(invocation.next_due_at === undefined ? {} : {nextDueAt: invocation.next_due_at}),
  };
}

export function toWorkflowExecutionEvent(dto: WorkflowExecutionEventDto): WorkflowExecutionEvent {
  return {
    source: dto.source,
    event: dto.event,
    deliveryId: dto.delivery_id,
    receivedAt: dto.received_at,
    project: dto.project,
    repository: dto.repository,
    ref: dto.ref,
    commit: dto.commit,
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

export function toEvaluationTrace(trace: EvaluationTraceDto | null): EvaluationTraceEntry[] | null {
  return trace?.map(toEvaluationTraceEntry) ?? null;
}

function toEvaluationTraceEntry(entry: EvaluationTraceDto[number]): EvaluationTraceEntry {
  if ('dropped' in entry) return entry;
  return {
    expression: entry.expression,
    roots: entry.roots,
    fillTarget: entry.fill_target,
    evaluatedAt: entry.evaluated_at,
    field: entry.field,
    ...(entry.value === undefined ? {} : {value: entry.value}),
    ...(entry.truncated === undefined ? {} : {truncated: entry.truncated}),
    ...(entry.expr_truncated === undefined ? {} : {exprTruncated: entry.expr_truncated}),
    ...(entry.reference === undefined ? {} : {reference: entry.reference}),
    ...(entry.degraded === undefined ? {} : {degraded: entry.degraded}),
    ...(entry.env_key === undefined ? {} : {envKey: entry.env_key}),
  };
}

function toAgentStepConfig(dto: WorkflowRunStepDetailDto): Step['agentConfig'] {
  if (dto.type !== 'agent') return null;
  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function toToolStepConfig(dto: WorkflowRunStepDetailDto): Step['toolConfig'] {
  if (dto.type !== 'tool') return null;
  const tool = toolConfigValue(dto.config);
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

function toolConfigValue(config: Record<string, unknown> | null): Record<string, unknown> | null {
  return recordConfigValue(config?.tool);
}

function recordConfigValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringConfigValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
