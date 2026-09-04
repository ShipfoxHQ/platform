import type {
  EvaluationTraceDto,
  StepAttemptDetailResponseDto,
  StepAttemptDto,
  StepGateResultDto,
  WorkflowExecutionEventDto,
  WorkflowRunAttemptDto,
  WorkflowRunJobListSummaryDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunLineageHeadResponseDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunSelectionResponseDto,
  WorkflowRunSourceResponseDto,
} from '@shipfox/api-workflows-dto';
import {
  type EvaluationTraceEntry,
  type StepAttemptSession,
  type StepGateResult,
  toWorkflowRunOverviewExecutionDuration,
  type WorkflowExecutionEvent,
  type WorkflowRun,
  WorkflowRunAttempt,
  WorkflowRunAttemptSummary,
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

type WorkflowRunBaseDto = Pick<
  WorkflowRunResponseDto,
  | 'id'
  | 'project_id'
  | 'definition_id'
  | 'number'
  | 'name'
  | 'workflow_name'
  | 'origin'
  | 'dev_source'
  | 'current_attempt'
  | 'trigger_provider'
  | 'trigger_source'
  | 'trigger_event'
  | 'trigger_reference'
  | 'created_at'
  | 'updated_at'
>;

export function toWorkflowRun(dto: WorkflowRunBaseDto): WorkflowRun {
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
    triggerReference: dto.trigger_reference,
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

export function toWorkflowRunRecord(
  dto: WorkflowRunResponseDto | WorkflowRunListItemDto,
): WorkflowRunRecord {
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
        // The optional display-count field is the rollout capability signal. Older API
        // responses only carry raw verdict counts, so mirror their non-terminal verdict into
        // execution evidence to keep each fallback glyph aligned with those counts.
        executionStatus: hasDisplayStatusCounts
          ? (job.execution_status ?? null)
          : fallbackExecutionStatus(job.status),
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

function fallbackExecutionStatus(
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

function toolConfigValue(config: Record<string, unknown> | null): Record<string, unknown> | null {
  return recordConfigValue(config?.tool);
}

function recordConfigValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
