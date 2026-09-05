import type {
  JobExecutionSummaryDto,
  WorkflowRunAttemptDto,
  WorkflowRunDevSourceDto,
  WorkflowRunDto,
  WorkflowRunLineageHeadDto,
  WorkflowRunListItemDto,
  WorkflowRunOverviewJobsResponseDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunSelectionDto,
  WorkflowRunTriggerReferenceDto,
} from '@shipfox/api-workflows-dto';
import {encodeStringIdCursor} from '@shipfox/node-drizzle';
import type {
  WorkflowRun,
  WorkflowRunDevSource,
  WorkflowRunList,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import type {
  WorkflowRunJobExecutionSummary,
  WorkflowRunJobOverview,
  WorkflowRunJobsSummary,
  WorkflowRunLineageHead,
  WorkflowRunOverviewJobsPageRead,
  WorkflowRunOverviewRead,
  WorkflowRunSelection,
} from '#db/index.js';

export function toRunDto(run: WorkflowRun, latestAttempt = run.currentAttempt): WorkflowRunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    number: run.number,
    name: run.name,
    workflow_name: run.workflowName,
    status: run.status,
    origin: run.origin,
    dev_source: toDevSourceDto(run.devSource),
    current_attempt: run.currentAttempt,
    latest_attempt: latestAttempt,
    trigger_provider: run.triggerProvider,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_payload: run.triggerPayload,
    trigger_reference: toTriggerReferenceDto(run.triggerReference),
    inputs: run.inputs,
    source_snapshot: run.sourceSnapshot,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

const EMPTY_JOBS: WorkflowRunJobsSummary = {
  preview: [],
  statusCounts: [],
  rawStatusCounts: [],
  hasStartedJobExecution: false,
};

export function toRunListItemDto(
  run: WorkflowRun | WorkflowRunList,
  jobs: WorkflowRunJobsSummary = EMPTY_JOBS,
): WorkflowRunListItemDto {
  return {
    ...toRunListDto(run),
    jobs: jobs.preview.map((job) => ({
      id: job.id,
      key: job.key,
      name: job.name,
      status: job.status,
      mode: job.mode,
      listener_status: job.listenerStatus,
      execution_status: job.executionStatus,
      position: job.position,
    })),
    job_status_counts: jobs.rawStatusCounts.map(({status, count}) => ({status, count})),
    job_display_status_counts: jobs.statusCounts.map(({status, count}) => ({status, count})),
    has_started_job_execution: jobs.hasStartedJobExecution,
  };
}

function toRunListDto(run: WorkflowRun | WorkflowRunList) {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    number: run.number,
    name: run.name,
    workflow_name: run.workflowName,
    status: run.status,
    origin: run.origin,
    dev_source: toDevSourceDto(run.devSource),
    current_attempt: run.currentAttempt,
    latest_attempt: run.currentAttempt,
    trigger_provider: run.triggerProvider,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_reference: toTriggerReferenceDto(run.triggerReference),
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

// The persisted reference predates `actor` and carries an internal project id the client has
// no use for, so each field is read defensively rather than spread onto the response.
function toTriggerReferenceDto(
  reference: WorkflowRunTriggerReference | null | undefined,
): WorkflowRunTriggerReferenceDto | null {
  if (!reference) return null;
  return {
    repository: reference.repository ?? null,
    ref: reference.ref ?? null,
    commit: reference.commit ?? null,
    actor: reference.actor ?? null,
  };
}

// The persisted dev source uses camelCase field names while the API contract is snake_case,
// so each field is mapped explicitly rather than spread onto the response.
function toDevSourceDto(
  devSource: WorkflowRunDevSource | null | undefined,
): WorkflowRunDevSourceDto | null {
  if (!devSource) return null;
  return {
    ref: devSource.ref,
    commit: devSource.commit,
    config_path: devSource.configPath,
    initiated_by_user_id: devSource.initiatedByUserId,
    replay_of_event_id: devSource.replayOfEventId,
  };
}

export function toRunAttemptDto(attempt: WorkflowRunAttempt): WorkflowRunAttemptDto {
  return {
    id: attempt.id,
    workflow_run_id: attempt.workflowRunId,
    attempt: attempt.attempt,
    status: attempt.status,
    created_at: attempt.createdAt.toISOString(),
    started_at: attempt.startedAt?.toISOString() ?? null,
    finished_at: attempt.finishedAt?.toISOString() ?? null,
    rerun_mode: attempt.rerunMode,
  };
}

export function toRunLineageHeadDto(head: WorkflowRunLineageHead): WorkflowRunLineageHeadDto {
  return {
    current_attempt: head.currentAttempt,
    latest_attempt: head.latestAttempt,
    current_status: head.currentStatus,
    updated_at: head.updatedAt.toISOString(),
  };
}

export function toRunSelectionDto(selection: WorkflowRunSelection): WorkflowRunSelectionDto {
  return {
    workflow_run_id: selection.workflowRunId,
    workflow_run_attempt: selection.workflowRunAttempt,
    job_id: selection.jobId,
    job_execution_id: selection.jobExecutionId,
    step_id: selection.stepId,
    step_attempt_id: selection.stepAttemptId,
    step_attempt: selection.stepAttempt,
    source_location:
      selection.sourceLocation === null
        ? null
        : {
            start_line: selection.sourceLocation.startLine,
            end_line: selection.sourceLocation.endLine,
          },
  };
}

export function toRunOverviewDto(
  overview: WorkflowRunOverviewRead,
  options: {forceLarge?: boolean; largePageSize?: number} = {},
): WorkflowRunOverviewResponseDto {
  const jobs = toOverviewJobsDto(overview, options);

  return {
    run: {
      id: overview.run.id,
      project_id: overview.run.projectId,
      definition_id: overview.run.definitionId,
      number: overview.run.number,
      name: overview.run.name,
      workflow_name: overview.run.workflowName,
      origin: overview.run.origin,
      dev_source: toDevSourceDto(overview.run.devSource),
      trigger_provider: overview.run.triggerProvider,
      trigger_source: overview.run.triggerSource,
      trigger_event: overview.run.triggerEvent,
      trigger_reference: toTriggerReferenceDto(overview.run.triggerReference),
      created_at: overview.run.createdAt.toISOString(),
    },
    attempt: toRunOverviewAttemptDto(overview.attempt),
    has_started_job_execution: overview.hasStartedJobExecution,
    jobs,
  };
}

function toOverviewJobsDto(
  overview: WorkflowRunOverviewRead,
  options: {forceLarge?: boolean; largePageSize?: number},
): WorkflowRunOverviewResponseDto['jobs'] {
  if (options.forceLarge) return toLargeOverviewJobsDto(overview, options.largePageSize);
  if (overview.jobs.kind === 'complete') {
    return {
      kind: 'complete',
      total: overview.jobs.total,
      items: overview.jobs.items.map(toJobOverviewDto),
    };
  }

  return {
    kind: 'large',
    total: overview.jobs.total,
    status_counts: overview.jobs.statusCounts,
    first_page: {
      items: overview.jobs.firstPage.items.map(toJobListSummaryDto),
      next_cursor: overview.jobs.firstPage.nextCursor
        ? encodeJobCursor(overview.jobs.firstPage.nextCursor)
        : null,
      total: overview.jobs.firstPage.total,
    },
  };
}

export function toRunOverviewJobsPageDto(
  page: WorkflowRunOverviewJobsPageRead,
): WorkflowRunOverviewJobsResponseDto {
  return {
    items: page.items.map(toJobListSummaryDto),
    next_cursor: page.nextCursor ? encodeJobCursor(page.nextCursor) : null,
    ...(page.total === undefined ? {} : {total: page.total}),
  };
}

function toLargeOverviewJobsDto(
  overview: WorkflowRunOverviewRead,
  pageSize?: number,
): Extract<WorkflowRunOverviewResponseDto['jobs'], {kind: 'large'}> {
  if (overview.jobs.kind === 'large') {
    const items = overview.jobs.firstPage.items.slice(
      0,
      pageSize ?? overview.jobs.firstPage.items.length,
    );
    const last = items.at(-1);
    return {
      kind: 'large',
      total: overview.jobs.total,
      status_counts: overview.jobs.statusCounts,
      first_page: {
        items: items.map(toJobListSummaryDto),
        next_cursor:
          last && items.length < overview.jobs.firstPage.total
            ? encodeJobCursor({position: last.position, id: last.id})
            : null,
        total: overview.jobs.firstPage.total,
      },
    };
  }

  const items = overview.jobs.items.slice(0, pageSize ?? overview.jobs.items.length);
  const last = items.at(-1);

  return {
    kind: 'large',
    total: overview.jobs.total,
    status_counts: overview.jobs.statusCounts,
    first_page: {
      items: items.map(toJobListSummaryDto),
      next_cursor:
        last && items.length < overview.jobs.total
          ? encodeJobCursor({position: last.position, id: last.id})
          : null,
      total: overview.jobs.total,
    },
  };
}

function toRunOverviewAttemptDto(
  attempt: WorkflowRunOverviewRead['attempt'],
): WorkflowRunOverviewResponseDto['attempt'] {
  return {
    id: attempt.id,
    workflow_run_id: attempt.workflowRunId,
    attempt: attempt.attempt,
    status: attempt.status,
    created_at: attempt.createdAt.toISOString(),
    started_at: attempt.startedAt?.toISOString() ?? null,
    finished_at: attempt.finishedAt?.toISOString() ?? null,
    rerun_mode: attempt.rerunMode,
  };
}

export function toJobOverviewDto(job: WorkflowRunJobOverview) {
  return {
    ...toJobSummaryFields(job),
    dependencies: job.dependencies,
  };
}

function toJobSummaryFields(job: Omit<WorkflowRunJobOverview, 'dependencies'>) {
  return {
    id: job.id,
    key: job.key,
    name: job.name,
    position: job.position,
    status: job.status,
    status_reason: job.statusReason,
    mode: job.mode,
    listener_status: job.listenerStatus,
    carried_over: job.carriedOver,
    execution_count: job.executionCount,
    execution_status_counts: job.executionStatusCounts,
    default_execution: job.defaultExecution ? toJobExecutionSummaryDto(job.defaultExecution) : null,
  };
}

export function toJobExecutionSummaryDto(
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

function toJobListSummaryDto(job: Omit<WorkflowRunJobOverview, 'dependencies'>) {
  return toJobSummaryFields(job);
}

function encodeJobCursor(cursor: {position: number; id: string}): string {
  return encodeStringIdCursor({value: String(cursor.position), id: cursor.id});
}
