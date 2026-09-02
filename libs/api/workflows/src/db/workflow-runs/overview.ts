import {
  JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH,
  WORKFLOW_RUN_EXECUTION_COUNT_LIMIT,
  WORKFLOW_RUN_OVERVIEW_COMPLETE_EDGE_LIMIT,
  WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT,
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
} from '@shipfox/api-workflows-dto';
import {and, asc, count, desc, eq, gt, inArray, ne, or, sql} from 'drizzle-orm';
import {
  type JobMode,
  type JobStatus,
  type JobStatusReason,
  type ListenerStatus,
  toJobStatusReason,
} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {
  WorkflowRunOriginState,
  WorkflowRunStatus,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import {db, type Tx} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRunOriginState, workflowRuns} from '../schema/workflow-runs.js';

export type BoundedExecutionCount = number | '100+';

export type WorkflowRunOverviewRun = WorkflowRunOriginState & {
  id: string;
  projectId: string;
  definitionId: string;
  number: number;
  name: string;
  workflowName: string;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerReference: WorkflowRunTriggerReference | null;
  createdAt: Date;
};

export interface WorkflowRunOverviewAttempt {
  id: string;
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  rerunMode: 'all' | 'failed' | null;
}

export interface WorkflowRunJobExecutionSummary {
  id: string;
  sequence: number;
  name: string;
  status: JobExecutionStatus;
  displayStatus: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  statusReasonMessage: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
  updatedAt: Date;
}

export interface WorkflowRunJobExecutionSummaryRow {
  id: string;
  sequence: number;
  name: string | null;
  jobName: string | null;
  jobKey: string;
  status: JobExecutionStatus;
  statusReason: string | null;
  statusReasonMessage: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
  updatedAt: Date;
  hasRunningStep?: boolean;
}

export interface WorkflowRunJobOverview {
  id: string;
  key: string;
  name: string | null;
  position: number;
  dependencies: string[];
  status: JobStatus;
  statusReason: JobStatusReason | null;
  mode: JobMode;
  listenerStatus: ListenerStatus;
  carriedOver: boolean;
  executionCount: BoundedExecutionCount;
  executionStatusCounts: Record<JobExecutionStatus, BoundedExecutionCount>;
  defaultExecution: WorkflowRunJobExecutionSummary | null;
}

export interface WorkflowRunJobOverviewReadOptions {
  onRead?: ((returnedRows: number) => void) | undefined;
}

export type WorkflowRunJobListSummary = Omit<WorkflowRunJobOverview, 'dependencies'>;

export interface WorkflowRunJobCursor {
  position: number;
  id: string;
}

export interface WorkflowRunOverviewJobStatusCount {
  status: JobStatus;
  count: number;
}

export interface WorkflowRunOverviewRead {
  run: WorkflowRunOverviewRun;
  attempt: WorkflowRunOverviewAttempt;
  hasStartedJobExecution: boolean;
  jobs:
    | {
        kind: 'complete';
        total: number;
        statusCounts: WorkflowRunOverviewJobStatusCount[];
        items: WorkflowRunJobOverview[];
      }
    | {
        kind: 'large';
        total: number;
        statusCounts: WorkflowRunOverviewJobStatusCount[];
        firstPage: {
          items: WorkflowRunJobListSummary[];
          nextCursor: WorkflowRunJobCursor | null;
          total: number;
        };
      };
}

export interface WorkflowRunOverviewJobsPageRead {
  items: WorkflowRunJobListSummary[];
  nextCursor: WorkflowRunJobCursor | null;
  total: number | undefined;
}

export interface WorkflowRunOverviewReadMeasurement {
  databaseDurationMilliseconds: number;
  returnedRows: number;
}

export interface WorkflowRunOverviewReadOptions {
  onRead?: ((measurement: WorkflowRunOverviewReadMeasurement) => void) | undefined;
}

export interface WorkflowRunOverviewParams {
  workflowRunId: string;
  projectId: string;
  attempt: number;
}

export interface WorkflowRunAccessScope {
  id: string;
  projectId: string;
}

/** Loads only the fields needed to authorize a read without hydrating legacy run payloads. */
export async function getWorkflowRunAccessScopeById(
  workflowRunId: string,
): Promise<WorkflowRunAccessScope | undefined> {
  const [row] = await db()
    .select({id: workflowRuns.id, projectId: workflowRuns.projectId})
    .from(workflowRuns)
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);
  return row;
}

export async function getWorkflowRunOverview(
  params: WorkflowRunOverviewParams,
  options: WorkflowRunOverviewReadOptions = {},
): Promise<WorkflowRunOverviewRead | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const result = await db().transaction(
      async (tx) => {
        const target = await loadOverviewTarget(tx, params);
        returnedRows += target === undefined ? 0 : 1;
        if (!target) return undefined;

        const cardinality = await loadJobCardinality(tx, target.attempt.id);
        returnedRows += cardinality.returnedRows;
        const statusCountRows = await loadJobStatusCounts(tx, target.attempt.id);
        returnedRows += statusCountRows.length;
        const hasStartedRows = await loadStartedExecution(tx, target.attempt.id);
        returnedRows += hasStartedRows.length;

        const statusCounts = toJobStatusCounts(statusCountRows);
        const large =
          cardinality.total > WORKFLOW_RUN_OVERVIEW_COMPLETE_JOB_LIMIT ||
          cardinality.dependencyEdges > WORKFLOW_RUN_OVERVIEW_COMPLETE_EDGE_LIMIT;
        const jobRows = large
          ? await loadJobPageRows(tx, target.attempt.id, WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT)
          : {rows: await loadCompleteJobRows(tx, target.attempt.id), nextCursor: null};
        returnedRows += jobRows.rows.length;

        const presentation = await loadJobPresentation(
          tx,
          target.attempt.id,
          jobRows.rows.map((row) => row.id),
        );
        returnedRows += presentation.returnedRows;
        const items = assembleJobOverviewItems(jobRows.rows, presentation);

        return {
          run: target.run,
          attempt: target.attempt,
          hasStartedJobExecution: hasStartedRows.length > 0,
          jobs: large
            ? {
                kind: 'large' as const,
                total: cardinality.total,
                statusCounts,
                firstPage: {
                  items: items.map(toJobListSummary),
                  nextCursor: jobRows.nextCursor,
                  total: cardinality.total,
                },
              }
            : {
                kind: 'complete' as const,
                total: cardinality.total,
                statusCounts,
                items,
              },
        };
      },
      {isolationLevel: 'repeatable read', accessMode: 'read only'},
    );

    return result;
  } finally {
    try {
      options.onRead?.({
        databaseDurationMilliseconds: performance.now() - startedAt,
        returnedRows,
      });
    } catch {
      // Measurement observers must not change the bounded read outcome.
    }
  }
}

export async function listWorkflowRunJobsPage(
  params: WorkflowRunOverviewParams & {
    limit: number;
    cursor?: WorkflowRunJobCursor | undefined;
  },
  options: WorkflowRunOverviewReadOptions = {},
): Promise<WorkflowRunOverviewJobsPageRead | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const result = await db().transaction(
      async (tx) => {
        const target = await loadOverviewTarget(tx, params);
        returnedRows += target === undefined ? 0 : 1;
        if (!target) return undefined;

        const page = await loadJobPageRows(tx, target.attempt.id, params.limit, params.cursor);
        returnedRows += page.rows.length;
        const total =
          params.cursor === undefined ? await loadJobCount(tx, target.attempt.id) : undefined;
        returnedRows += params.cursor === undefined ? 1 : 0;

        const presentation = await loadJobPresentation(
          tx,
          target.attempt.id,
          page.rows.map((row) => row.id),
        );
        returnedRows += presentation.returnedRows;

        return {
          items: assembleJobOverviewItems(page.rows, presentation).map(toJobListSummary),
          nextCursor: page.nextCursor,
          total,
        };
      },
      {isolationLevel: 'repeatable read', accessMode: 'read only'},
    );

    return result;
  } finally {
    try {
      options.onRead?.({
        databaseDurationMilliseconds: performance.now() - startedAt,
        returnedRows,
      });
    } catch {
      // Measurement observers must not change the bounded read outcome.
    }
  }
}

/**
 * Reads the same compact job projection used by the run overview for one job inside
 * a caller-owned transaction. The transaction keeps this summary consistent with
 * the selected execution and its step pages.
 */
export async function getWorkflowRunJobOverview(
  tx: Tx,
  params: {workflowRunAttemptId: string; jobId: string},
  options: WorkflowRunJobOverviewReadOptions = {},
): Promise<WorkflowRunJobOverview | undefined> {
  const [row] = await tx
    .select({
      id: jobs.id,
      key: jobs.key,
      name: jobs.name,
      position: jobs.position,
      dependencies: jobs.dependencies,
      status: jobs.status,
      statusReason: jobs.statusReason,
      mode: jobs.mode,
      listenerStatus: jobs.listenerStatus,
      carriedOver: jobs.carriedOver,
    })
    .from(jobs)
    .where(
      and(eq(jobs.id, params.jobId), eq(jobs.workflowRunAttemptId, params.workflowRunAttemptId)),
    )
    .limit(1);
  if (!row) {
    options.onRead?.(0);
    return undefined;
  }

  const presentation = await loadJobPresentation(tx, params.workflowRunAttemptId, [params.jobId]);
  options.onRead?.(1 + presentation.returnedRows);
  return assembleJobOverviewItems(
    [{...row, dependencies: row.dependencies as string[]}],
    presentation,
  )[0];
}

interface OverviewTarget {
  run: WorkflowRunOverviewRun;
  attempt: WorkflowRunOverviewAttempt;
}

async function loadOverviewTarget(
  tx: Tx,
  params: Pick<WorkflowRunOverviewParams, 'workflowRunId' | 'projectId' | 'attempt'>,
): Promise<OverviewTarget | undefined> {
  const [row] = await tx
    .select({
      runId: workflowRuns.id,
      projectId: workflowRuns.projectId,
      definitionId: workflowRuns.definitionId,
      number: workflowRuns.number,
      name: workflowRuns.name,
      workflowName: workflowRuns.workflowName,
      origin: workflowRuns.origin,
      devSource: workflowRuns.devSource,
      triggerProvider: workflowRuns.triggerProvider,
      triggerSource: workflowRuns.triggerSource,
      triggerEvent: workflowRuns.triggerEvent,
      triggerReference: workflowRuns.triggerReference,
      createdAt: workflowRuns.createdAt,
      attemptId: workflowRunAttempts.id,
      attemptWorkflowRunId: workflowRunAttempts.workflowRunId,
      attempt: workflowRunAttempts.attempt,
      attemptStatus: workflowRunAttempts.status,
      attemptCreatedAt: workflowRunAttempts.createdAt,
      attemptStartedAt: workflowRunAttempts.startedAt,
      attemptFinishedAt: workflowRunAttempts.finishedAt,
      attemptRerunMode: workflowRunAttempts.rerunMode,
    })
    .from(workflowRuns)
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
        eq(workflowRunAttempts.attempt, params.attempt),
      ),
    )
    .where(
      and(eq(workflowRuns.id, params.workflowRunId), eq(workflowRuns.projectId, params.projectId)),
    )
    .limit(1);
  if (!row) return undefined;

  const originState = toWorkflowRunOriginState({
    origin: row.origin,
    devSource: row.devSource ?? null,
  });
  return {
    run: {
      id: row.runId,
      projectId: row.projectId,
      definitionId: row.definitionId,
      number: row.number,
      name: row.name ?? row.workflowName,
      workflowName: row.workflowName,
      ...originState,
      triggerProvider: row.triggerProvider,
      triggerSource: row.triggerSource,
      triggerEvent: row.triggerEvent,
      triggerReference: row.triggerReference ?? null,
      createdAt: row.createdAt,
    },
    attempt: {
      id: row.attemptId,
      workflowRunId: row.attemptWorkflowRunId,
      attempt: row.attempt,
      status: row.attemptStatus,
      createdAt: row.attemptCreatedAt,
      startedAt: row.attemptStartedAt,
      finishedAt: row.attemptFinishedAt,
      rerunMode: row.attemptRerunMode,
    },
  };
}

async function loadJobCardinality(
  tx: Tx,
  workflowRunAttemptId: string,
): Promise<{total: number; dependencyEdges: number; returnedRows: number}> {
  const [row] = await tx
    .select({
      total: count(),
      dependencyEdges: sql<number>`coalesce(sum(jsonb_array_length(${jobs.dependencies})), 0)`,
    })
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId));
  return {
    total: Number(row?.total ?? 0),
    dependencyEdges: Number(row?.dependencyEdges ?? 0),
    returnedRows: row ? 1 : 0,
  };
}

async function loadJobCount(tx: Tx, workflowRunAttemptId: string): Promise<number> {
  const [row] = await tx
    .select({total: count()})
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId));
  return Number(row?.total ?? 0);
}

async function loadJobStatusCounts(
  tx: Tx,
  workflowRunAttemptId: string,
): Promise<{status: JobStatus; count: number}[]> {
  const rows = await tx
    .select({status: jobs.status, count: count()})
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .groupBy(jobs.status)
    .orderBy(asc(jobs.status));
  return rows.map((row) => ({status: row.status, count: Number(row.count)}));
}

function loadStartedExecution(tx: Tx, workflowRunAttemptId: string) {
  return tx
    .select({id: jobExecutions.id})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(
      and(
        eq(jobs.workflowRunAttemptId, workflowRunAttemptId),
        sql`${jobExecutions.startedAt} is not null`,
      ),
    )
    .limit(1);
}

interface WorkflowRunJobRow {
  id: string;
  key: string;
  name: string | null;
  position: number;
  dependencies: string[];
  status: JobStatus;
  statusReason: string | null;
  mode: JobMode;
  listenerStatus: ListenerStatus;
  carriedOver: boolean;
}

interface WorkflowRunJobPageRows {
  rows: WorkflowRunJobRow[];
  nextCursor: WorkflowRunJobCursor | null;
}

async function loadCompleteJobRows(
  tx: Tx,
  workflowRunAttemptId: string,
): Promise<WorkflowRunJobRow[]> {
  const rows = await tx
    .select({
      id: jobs.id,
      key: jobs.key,
      name: jobs.name,
      position: jobs.position,
      dependencies: jobs.dependencies,
      status: jobs.status,
      statusReason: jobs.statusReason,
      mode: jobs.mode,
      listenerStatus: jobs.listenerStatus,
      carriedOver: jobs.carriedOver,
    })
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .orderBy(asc(jobs.position), asc(jobs.id));
  return rows.map((row) => ({...row, dependencies: row.dependencies as string[]}));
}

async function loadJobPageRows(
  tx: Tx,
  workflowRunAttemptId: string,
  limit: number,
  cursor?: WorkflowRunJobCursor | undefined,
): Promise<WorkflowRunJobPageRows> {
  const conditions = [eq(jobs.workflowRunAttemptId, workflowRunAttemptId)];
  if (cursor) {
    const cursorCondition = or(
      gt(jobs.position, cursor.position),
      and(eq(jobs.position, cursor.position), gt(jobs.id, cursor.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }
  const rows = await tx
    .select({
      id: jobs.id,
      key: jobs.key,
      name: jobs.name,
      position: jobs.position,
      status: jobs.status,
      statusReason: jobs.statusReason,
      mode: jobs.mode,
      listenerStatus: jobs.listenerStatus,
      carriedOver: jobs.carriedOver,
    })
    .from(jobs)
    .where(and(...conditions))
    .orderBy(asc(jobs.position), asc(jobs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    rows: pageRows.map((row) => ({...row, dependencies: []})),
    nextCursor: hasMore && last ? {position: last.position, id: last.id} : null,
  };
}

interface JobExecutionProjection extends WorkflowRunJobExecutionSummaryRow {
  jobId: string;
}

interface JobPresentation {
  executionStatusCounts: Map<string, Record<JobExecutionStatus, BoundedExecutionCount>>;
  executionCounts: Map<string, BoundedExecutionCount>;
  defaultExecutions: Map<string, WorkflowRunJobExecutionSummary>;
  returnedRows: number;
}

async function loadJobPresentation(
  tx: Tx,
  workflowRunAttemptId: string,
  jobIds: readonly string[],
): Promise<JobPresentation> {
  if (jobIds.length === 0) {
    return {
      executionStatusCounts: new Map(),
      executionCounts: new Map(),
      defaultExecutions: new Map(),
      returnedRows: 0,
    };
  }

  const statusRows = await tx
    .select({jobId: jobExecutions.jobId, status: jobExecutions.status, count: count()})
    .from(jobExecutions)
    .where(inArray(jobExecutions.jobId, [...jobIds]))
    .groupBy(jobExecutions.jobId, jobExecutions.status);
  const runningRows = await loadRunningExecutionRows(tx, workflowRunAttemptId, jobIds);
  const latestRows = await loadLatestExecutionRows(tx, workflowRunAttemptId, jobIds);

  const executionStatusCounts = new Map<
    string,
    Record<JobExecutionStatus, BoundedExecutionCount>
  >();
  const executionCounts = new Map<string, BoundedExecutionCount>();
  const exactTotals = new Map<string, number>();
  for (const row of statusRows) {
    const counts = executionStatusCounts.get(row.jobId) ?? createEmptyExecutionStatusCounts();
    const current = counts[row.status];
    const currentExact = typeof current === 'number' ? current : WORKFLOW_RUN_EXECUTION_COUNT_LIMIT;
    const rowCount = Number(row.count);
    counts[row.status] = boundedExecutionCount(currentExact + rowCount);
    executionStatusCounts.set(row.jobId, counts);

    const total = (exactTotals.get(row.jobId) ?? 0) + rowCount;
    exactTotals.set(row.jobId, total);
    executionCounts.set(row.jobId, boundedExecutionCount(total));
  }

  const defaultExecutions = new Map<string, WorkflowRunJobExecutionSummary>();
  const runningByJob = new Map<string, JobExecutionProjection>();
  for (const row of runningRows) {
    if (!runningByJob.has(row.jobId)) runningByJob.set(row.jobId, row);
  }
  const latestByJob = new Map(latestRows.map((row) => [row.jobId, row]));
  for (const jobId of jobIds) {
    const row = runningByJob.get(jobId) ?? latestByJob.get(jobId);
    if (row) defaultExecutions.set(jobId, toExecutionSummary(row));
  }
  applyDisplayStatusAdjustments(executionStatusCounts, defaultExecutions, jobIds);

  return {
    executionStatusCounts,
    executionCounts,
    defaultExecutions,
    returnedRows: statusRows.length + runningRows.length + latestRows.length,
  };
}

function applyDisplayStatusAdjustments(
  executionStatusCounts: Map<string, Record<JobExecutionStatus, BoundedExecutionCount>>,
  defaultExecutions: Map<string, WorkflowRunJobExecutionSummary>,
  jobIds: readonly string[],
): void {
  for (const jobId of jobIds) {
    const defaultExecution = defaultExecutions.get(jobId);
    if (!isPendingDisplayAdjustment(defaultExecution)) continue;
    const counts = executionStatusCounts.get(jobId);
    if (!counts) continue;
    counts.running = decrementBoundedExecutionCount(counts.running);
    counts.pending = incrementBoundedExecutionCount(counts.pending);
  }
}

function isPendingDisplayAdjustment(
  execution: WorkflowRunJobExecutionSummary | undefined,
): boolean {
  return execution?.status === 'running' && execution.displayStatus === 'pending';
}

export function runningStepExists(executionId: typeof jobExecutions.id) {
  return sql<boolean>`exists (
    select 1
    from ${steps}
    where ${steps.jobExecutionId} = ${executionId}
      and ${steps.status} = 'running'
  )`;
}

function loadRunningExecutionRows(
  tx: Tx,
  workflowRunAttemptId: string,
  jobIds: readonly string[],
): Promise<JobExecutionProjection[]> {
  return tx
    .select({
      jobId: jobExecutions.jobId,
      id: jobExecutions.id,
      sequence: jobExecutions.sequence,
      name: jobExecutions.name,
      jobName: jobs.name,
      jobKey: jobs.key,
      status: jobExecutions.status,
      statusReason: jobExecutions.statusReason,
      statusReasonMessage: jobExecutions.statusReasonMessage,
      queuedAt: jobExecutions.queuedAt,
      startedAt: jobExecutions.startedAt,
      finishedAt: jobExecutions.finishedAt,
      timedOutAt: jobExecutions.timedOutAt,
      updatedAt: jobExecutions.updatedAt,
      hasRunningStep: runningStepExists(jobExecutions.id),
    })
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(
      and(
        eq(jobs.workflowRunAttemptId, workflowRunAttemptId),
        eq(jobExecutions.status, 'running'),
        inArray(jobExecutions.jobId, [...jobIds]),
      ),
    )
    .orderBy(asc(jobExecutions.jobId), desc(jobExecutions.sequence), desc(jobExecutions.id));
}

function loadLatestExecutionRows(
  tx: Tx,
  workflowRunAttemptId: string,
  jobIds: readonly string[],
): Promise<JobExecutionProjection[]> {
  return tx
    .selectDistinctOn([jobExecutions.jobId], {
      jobId: jobExecutions.jobId,
      id: jobExecutions.id,
      sequence: jobExecutions.sequence,
      name: jobExecutions.name,
      jobName: jobs.name,
      jobKey: jobs.key,
      status: jobExecutions.status,
      statusReason: jobExecutions.statusReason,
      statusReasonMessage: jobExecutions.statusReasonMessage,
      queuedAt: jobExecutions.queuedAt,
      startedAt: jobExecutions.startedAt,
      finishedAt: jobExecutions.finishedAt,
      timedOutAt: jobExecutions.timedOutAt,
      updatedAt: jobExecutions.updatedAt,
    })
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(
      and(
        eq(jobs.workflowRunAttemptId, workflowRunAttemptId),
        ne(jobExecutions.status, 'running'),
        inArray(jobExecutions.jobId, [...jobIds]),
      ),
    )
    .orderBy(asc(jobExecutions.jobId), desc(jobExecutions.sequence), desc(jobExecutions.id));
}

function assembleJobOverviewItems(
  rows: readonly WorkflowRunJobRow[],
  presentation: JobPresentation,
): WorkflowRunJobOverview[] {
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    name: row.name,
    position: row.position,
    dependencies: row.dependencies,
    status: row.status,
    statusReason: toJobStatusReason(row.statusReason),
    mode: row.mode,
    listenerStatus: row.listenerStatus,
    carriedOver: row.carriedOver,
    executionCount: presentation.executionCounts.get(row.id) ?? 0,
    executionStatusCounts:
      presentation.executionStatusCounts.get(row.id) ?? createEmptyExecutionStatusCounts(),
    defaultExecution: presentation.defaultExecutions.get(row.id) ?? null,
  }));
}

function toJobListSummary(job: WorkflowRunJobOverview): WorkflowRunJobListSummary {
  const {dependencies: _dependencies, ...summary} = job;
  return summary;
}

export function toExecutionSummary(
  row: WorkflowRunJobExecutionSummaryRow,
): WorkflowRunJobExecutionSummary {
  const displayStatus =
    row.status === 'running' && row.hasRunningStep !== true ? 'pending' : row.status;
  return {
    id: row.id,
    sequence: row.sequence,
    name: row.name ?? row.jobName ?? row.jobKey,
    status: row.status,
    displayStatus,
    statusReason: toJobStatusReason(row.statusReason),
    statusReasonMessage:
      row.statusReasonMessage?.slice(0, JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH) ?? null,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    timedOutAt: row.timedOutAt,
    updatedAt: row.updatedAt,
  };
}

function createEmptyExecutionStatusCounts(): Record<JobExecutionStatus, BoundedExecutionCount> {
  return {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
}

export function boundedExecutionCount(value: number): BoundedExecutionCount {
  return value > WORKFLOW_RUN_EXECUTION_COUNT_LIMIT ? '100+' : value;
}

function decrementBoundedExecutionCount(value: BoundedExecutionCount): BoundedExecutionCount {
  return value === '100+' ? value : Math.max(0, value - 1);
}

function incrementBoundedExecutionCount(value: BoundedExecutionCount): BoundedExecutionCount {
  return value === '100+' ? value : boundedExecutionCount(value + 1);
}

function toJobStatusCounts(
  rows: readonly {status: JobStatus; count: number}[],
): WorkflowRunOverviewJobStatusCount[] {
  return rows.map(({status, count: value}) => ({status, count: value}));
}
