import type {WorkflowRunDiagnosticReadLimits} from '@shipfox/api-workflows-dto';
import {
  getWorkflowRunSelectionDepth,
  WORKFLOW_RUN_JOB_PREVIEW_LIMIT,
  type WorkflowRunSelectionQueryDto,
} from '@shipfox/api-workflows-dto';
import {
  type NumberIdCursor,
  paginateTimestampIdRows,
  type TimestampIdCursor,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {and, asc, count, desc, eq, gte, lt, lte, or, type SQL, sql} from 'drizzle-orm';
import type {JobMode, JobStatus, ListenerStatus} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {StepSourceLocation} from '#core/entities/step.js';
import type {
  JobExecutionDetail,
  StepDetail,
  WorkflowJobDetail,
  WorkflowRun,
  WorkflowRunDetail,
  WorkflowRunOrigin,
  WorkflowRunStatus,
} from '#core/entities/workflow-run.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import {db} from '../db.js';
import {jobExecutions, toJobExecution} from '../schema/job-executions.js';
import {jobs, toJob} from '../schema/jobs.js';
import {stepAttempts, toStepAttempt} from '../schema/step-attempts.js';
import {steps, toStep} from '../schema/steps.js';
import {toWorkflowRunAttempt, workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {getWorkflowRunDiagnosticDetail} from './diagnostic-detail.js';

export type WorkflowRunCursor = TimestampIdCursor;

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus | undefined;
  definitionId?: string | undefined;
  triggerSource?: string | undefined;
  origin?: WorkflowRunOrigin | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
}

export interface ListWorkflowRunsParams {
  projectId: string;
  workspaceId?: string | undefined;
  limit: number;
  cursor?: WorkflowRunCursor | undefined;
  filters?: WorkflowRunFilters | undefined;
  includeTotal?: boolean | undefined;
}

export interface ListWorkflowRunsResult {
  runs: WorkflowRun[];
  nextCursor: WorkflowRunCursor | null;
  filteredTotalCount: number | null;
}

export type WorkflowRunAttemptCursor = NumberIdCursor;

export interface ListRunAttemptsPageResult {
  attempts: WorkflowRunAttempt[];
  nextCursor: WorkflowRunAttemptCursor | null;
}

export interface WorkflowRunLineageHead {
  currentAttempt: number;
  latestAttempt: number;
  currentStatus: WorkflowRunStatus;
  updatedAt: Date;
}

export interface WorkflowRunSelection {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string | null;
  stepId: string | null;
  stepAttemptId: string | null;
  stepAttempt: number | null;
  sourceLocation: StepSourceLocation | null;
}

export interface WorkflowRunSelectionParams {
  workflowRunId: string;
  projectId: string;
  query: WorkflowRunSelectionQueryDto;
}

export interface WorkflowRunBoundedReadMeasurement {
  databaseDurationMilliseconds: number;
  returnedRows: number;
}

export interface WorkflowRunBoundedReadOptions {
  onRead?: ((measurement: WorkflowRunBoundedReadMeasurement) => void) | undefined;
}

/** A run-list job glyph: enough to draw and label it, none of its steps. */
export interface WorkflowRunJobSummary {
  id: string;
  key: string;
  name: string | null;
  status: JobStatus;
  mode: JobMode;
  listenerStatus: ListenerStatus;
  executionStatus: JobExecutionStatus | null;
  position: number;
}

export interface WorkflowRunAggregates {
  status: Array<{value: WorkflowRunStatus; count: number}>;
  triggerSource: Array<{value: string; count: number}>;
  workflow: Array<{value: string; count: number}>;
}

export interface WorkflowJobExecutionDepth {
  runningRuns: number;
  runningJobExecutions: number;
}

export interface WorkflowJobExecutionDepthParams {
  workspaceId?: string;
}

export interface WorkflowRunDetailReadMeasurement {
  databaseDurationMilliseconds: number;
  returnedRows: number;
}

export interface WorkflowRunDetailReadOptions {
  onRead?: ((measurement: WorkflowRunDetailReadMeasurement) => void) | undefined;
  diagnosticLimits?: WorkflowRunDiagnosticReadLimits | undefined;
}

export async function getWorkflowRunById(
  id: string,
  workspaceId?: string | undefined,
): Promise<WorkflowRun | undefined> {
  const conditions = [eq(workflowRuns.id, id)];
  if (workspaceId) conditions.push(eq(workflowRuns.workspaceId, workspaceId));
  const rows = await db()
    .select()
    .from(workflowRuns)
    .where(and(...conditions))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkflowRun(row);
}

export async function getWorkflowRunByAttemptId(
  workflowRunAttemptId: string,
): Promise<WorkflowRun | undefined> {
  const rows = await db()
    .select({run: workflowRuns})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(workflowRunAttempts.id, workflowRunAttemptId))
    .limit(1);
  const row = rows[0];
  return row ? toWorkflowRun(row.run) : undefined;
}

export async function getWorkflowRunAttemptById(workflowRunAttemptId: string) {
  const rows = await db()
    .select()
    .from(workflowRunAttempts)
    .where(eq(workflowRunAttempts.id, workflowRunAttemptId))
    .limit(1);
  const row = rows[0];
  return row ? toWorkflowRunAttempt(row) : undefined;
}

export async function listRunAttempts(params: {workflowRunId: string; projectId: string}) {
  return (
    await db()
      .select({
        attempt: workflowRunAttempts,
      })
      .from(workflowRunAttempts)
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(
        and(
          eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
          eq(workflowRuns.projectId, params.projectId),
        ),
      )
      .orderBy(asc(workflowRunAttempts.attempt))
  ).map((row) => toWorkflowRunAttempt(row.attempt));
}

export async function listRunAttemptsPage(
  params: {
    workflowRunId: string;
    projectId: string;
    limit: number;
    cursor?: WorkflowRunAttemptCursor | undefined;
  },
  options: WorkflowRunBoundedReadOptions = {},
): Promise<ListRunAttemptsPageResult> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const cursorCondition = params.cursor
      ? or(
          lt(workflowRunAttempts.attempt, params.cursor.value),
          and(
            eq(workflowRunAttempts.attempt, params.cursor.value),
            lt(workflowRunAttempts.id, params.cursor.id),
          ),
        )
      : undefined;
    const conditions = [
      eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
      eq(workflowRuns.projectId, params.projectId),
    ];
    if (cursorCondition) conditions.push(cursorCondition);

    const rows = await db()
      .select({attempt: workflowRunAttempts})
      .from(workflowRunAttempts)
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(and(...conditions))
      .orderBy(desc(workflowRunAttempts.attempt), desc(workflowRunAttempts.id))
      .limit(params.limit + 1);
    returnedRows = rows.length;

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    const last = pageRows.at(-1)?.attempt;

    return {
      attempts: pageRows.map((row) => toWorkflowRunAttempt(row.attempt)),
      nextCursor: hasMore && last ? {value: last.attempt, id: last.id} : null,
    };
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

export async function getWorkflowRunLineageHead(
  params: {workflowRunId: string; projectId: string},
  options: WorkflowRunBoundedReadOptions = {},
): Promise<WorkflowRunLineageHead | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const [row] = await db()
      .select({
        currentAttempt: workflowRuns.currentAttempt,
        currentStatus: workflowRuns.status,
        updatedAt: workflowRuns.updatedAt,
        latestAttempt: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`,
      })
      .from(workflowRuns)
      .leftJoin(workflowRunAttempts, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(
        and(
          eq(workflowRuns.id, params.workflowRunId),
          eq(workflowRuns.projectId, params.projectId),
        ),
      )
      .groupBy(
        workflowRuns.id,
        workflowRuns.currentAttempt,
        workflowRuns.status,
        workflowRuns.updatedAt,
      )
      .limit(1);
    returnedRows = row ? 1 : 0;

    return row
      ? {
          currentAttempt: row.currentAttempt,
          latestAttempt: Number(row.latestAttempt),
          currentStatus: row.currentStatus,
          updatedAt: row.updatedAt,
        }
      : undefined;
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

type WorkflowRunSelectionRow = {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string | null;
  stepId: string | null;
  stepAttemptId: string | null;
  stepAttempt: number | null;
  sourceLocation: StepSourceLocation | null;
};

/**
 * Resolve only the supplied identity's ancestry. Each branch starts at the deepest supplied
 * identity so the resolver never scans unrelated executions, steps, or step-attempt history.
 */
export function getWorkflowRunSelection(
  params: WorkflowRunSelectionParams,
  options: WorkflowRunBoundedReadOptions = {},
): Promise<WorkflowRunSelection | undefined> {
  switch (getWorkflowRunSelectionDepth(params.query)) {
    case 'step_attempt':
      return getStepAttemptSelection(params, options);
    case 'step':
      return getStepSelection(params, options);
    case 'execution':
      return getJobExecutionSelection(params, options);
    case 'job':
      return getJobSelection(params, options);
  }
}

function getStepAttemptSelection(
  params: WorkflowRunSelectionParams,
  options: WorkflowRunBoundedReadOptions,
): Promise<WorkflowRunSelection | undefined> {
  const stepAttemptId = params.query.step_attempt_id;
  if (!stepAttemptId) return Promise.resolve(undefined);

  const identityConditions: SQL[] = [eq(stepAttempts.id, stepAttemptId)];
  if (params.query.step_id) identityConditions.push(eq(steps.id, params.query.step_id));
  if (params.query.job_execution_id) {
    identityConditions.push(eq(jobExecutions.id, params.query.job_execution_id));
  }
  if (params.query.job_id) identityConditions.push(eq(jobs.id, params.query.job_id));

  return readWorkflowRunSelection(
    () =>
      db()
        .select({
          workflowRunId: workflowRuns.id,
          workflowRunAttempt: workflowRunAttempts.attempt,
          jobId: jobs.id,
          jobExecutionId: jobExecutions.id,
          stepId: steps.id,
          stepAttemptId: stepAttempts.id,
          stepAttempt: stepAttempts.attempt,
          sourceLocation: steps.sourceLocation,
        })
        .from(stepAttempts)
        .innerJoin(
          steps,
          and(
            eq(stepAttempts.stepId, steps.id),
            eq(stepAttempts.jobExecutionId, steps.jobExecutionId),
          ),
        )
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .where(and(...workflowRunSelectionConditions(params, ...identityConditions)))
        .limit(1),
    (row) => row,
    options,
  );
}

function getStepSelection(
  params: WorkflowRunSelectionParams,
  options: WorkflowRunBoundedReadOptions,
): Promise<WorkflowRunSelection | undefined> {
  const stepId = params.query.step_id;
  if (!stepId) return Promise.resolve(undefined);

  const identityConditions: SQL[] = [eq(steps.id, stepId)];
  if (params.query.job_execution_id) {
    identityConditions.push(eq(jobExecutions.id, params.query.job_execution_id));
  }
  if (params.query.job_id) identityConditions.push(eq(jobs.id, params.query.job_id));

  return readWorkflowRunSelection(
    () =>
      db()
        .select({
          workflowRunId: workflowRuns.id,
          workflowRunAttempt: workflowRunAttempts.attempt,
          jobId: jobs.id,
          jobExecutionId: jobExecutions.id,
          stepId: steps.id,
          stepAttemptId: sql<string | null>`null`,
          stepAttempt: sql<number | null>`null`,
          sourceLocation: steps.sourceLocation,
        })
        .from(steps)
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .where(and(...workflowRunSelectionConditions(params, ...identityConditions)))
        .limit(1),
    (row) => row,
    options,
  );
}

function getJobExecutionSelection(
  params: WorkflowRunSelectionParams,
  options: WorkflowRunBoundedReadOptions,
): Promise<WorkflowRunSelection | undefined> {
  const jobExecutionId = params.query.job_execution_id;
  if (!jobExecutionId) return Promise.resolve(undefined);

  const identityConditions: SQL[] = [eq(jobExecutions.id, jobExecutionId)];
  if (params.query.job_id) identityConditions.push(eq(jobs.id, params.query.job_id));

  return readWorkflowRunSelection(
    () =>
      db()
        .select({
          workflowRunId: workflowRuns.id,
          workflowRunAttempt: workflowRunAttempts.attempt,
          jobId: jobs.id,
          jobExecutionId: jobExecutions.id,
          stepId: sql<string | null>`null`,
          stepAttemptId: sql<string | null>`null`,
          stepAttempt: sql<number | null>`null`,
          sourceLocation: sql<StepSourceLocation | null>`null`,
        })
        .from(jobExecutions)
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .where(and(...workflowRunSelectionConditions(params, ...identityConditions)))
        .limit(1),
    (row) => row,
    options,
  );
}

function getJobSelection(
  params: WorkflowRunSelectionParams,
  options: WorkflowRunBoundedReadOptions,
): Promise<WorkflowRunSelection | undefined> {
  const jobId = params.query.job_id;
  if (!jobId) return Promise.resolve(undefined);

  return readWorkflowRunSelection(
    () =>
      db()
        .select({
          workflowRunId: workflowRuns.id,
          workflowRunAttempt: workflowRunAttempts.attempt,
          jobId: jobs.id,
          jobExecutionId: sql<string | null>`null`,
          stepId: sql<string | null>`null`,
          stepAttemptId: sql<string | null>`null`,
          stepAttempt: sql<number | null>`null`,
          sourceLocation: sql<StepSourceLocation | null>`null`,
        })
        .from(jobs)
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .where(and(...workflowRunSelectionConditions(params, eq(jobs.id, jobId))))
        .limit(1),
    (row) => row,
    options,
  );
}

function workflowRunSelectionConditions(
  params: WorkflowRunSelectionParams,
  ...identityConditions: SQL[]
): SQL[] {
  const conditions: SQL[] = [
    eq(workflowRuns.id, params.workflowRunId),
    eq(workflowRuns.projectId, params.projectId),
    ...identityConditions,
  ];
  if (params.query.attempt !== undefined) {
    conditions.push(eq(workflowRunAttempts.attempt, params.query.attempt));
  }
  return conditions;
}

async function readWorkflowRunSelection<T extends WorkflowRunSelectionRow>(
  read: () => Promise<T[]>,
  map: (row: T) => WorkflowRunSelection,
  options: WorkflowRunBoundedReadOptions,
): Promise<WorkflowRunSelection | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;

  try {
    const rows = await read();
    returnedRows = rows.length;
    const row = rows[0];
    return row ? map(row) : undefined;
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

export async function getLatestAttempt(params: {
  workflowRunId: string;
  projectId: string;
}): Promise<number> {
  const [row] = await db()
    .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      and(
        eq(workflowRunAttempts.workflowRunId, params.workflowRunId),
        eq(workflowRuns.projectId, params.projectId),
      ),
    )
    .limit(1);

  return Number(row?.value ?? 1);
}

export async function getLatestRunAttempt(params: {
  workflowRunId: string;
  workspaceId: string;
}): Promise<number | undefined> {
  const run = await getWorkflowRunById(params.workflowRunId, params.workspaceId);
  if (!run) return undefined;

  return getLatestAttempt({workflowRunId: run.id, projectId: run.projectId});
}

export function buildWorkflowRunListConditions(params: {
  projectId: string;
  workspaceId?: string | undefined;
  filters?: WorkflowRunFilters | undefined;
  cursor?: WorkflowRunCursor | undefined;
  omit?: 'status' | 'definitionId' | 'triggerSource' | 'origin' | undefined;
}): SQL[] {
  const filters = params.filters;
  const conditions: SQL[] = [eq(workflowRuns.projectId, params.projectId)];
  if (params.workspaceId) conditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: workflowRuns.createdAt,
    idColumn: workflowRuns.id,
    cursor: params.cursor,
  });
  if (cursorCondition) conditions.push(cursorCondition);
  if (filters?.status && params.omit !== 'status') {
    conditions.push(eq(workflowRuns.status, filters.status));
  }
  if (filters?.definitionId && params.omit !== 'definitionId') {
    conditions.push(eq(workflowRuns.definitionId, filters.definitionId));
  }
  if (filters?.triggerSource && params.omit !== 'triggerSource') {
    conditions.push(eq(workflowRuns.triggerSource, filters.triggerSource));
  }
  if (filters?.origin && params.omit !== 'origin') {
    conditions.push(eq(workflowRuns.origin, filters.origin));
  }
  if (filters?.createdFrom) {
    conditions.push(gte(workflowRuns.createdAt, filters.createdFrom));
  }
  if (filters?.createdTo) {
    conditions.push(lte(workflowRuns.createdAt, filters.createdTo));
  }
  return conditions;
}

export async function listWorkflowRuns(
  params: ListWorkflowRunsParams,
): Promise<ListWorkflowRunsResult> {
  const conditions = buildWorkflowRunListConditions(params);
  const rows = await db()
    .select()
    .from(workflowRuns)
    .where(and(...conditions))
    .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
    .limit(params.limit + 1);

  let totalCount: number | null = null;
  if (params.includeTotal) {
    const [{value} = {value: 0}] = await db()
      .select({value: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            workspaceId: params.workspaceId,
            filters: params.filters,
          }),
        ),
      );
    totalCount = value;
  }

  const page = paginateTimestampIdRows({rows, limit: params.limit, timestampKey: 'createdAt'});

  return {
    runs: page.pageRows.map(toWorkflowRun),
    nextCursor: page.nextCursor,
    filteredTotalCount: totalCount,
  };
}

/** The run whose jobs to fetch, pinned to the attempt the caller already read. */
export interface WorkflowRunJobSummaryTarget {
  id: string;
  currentAttempt: number;
}

/**
 * A page row's jobs: a bounded slice to draw, totals describing all of them, and whether any
 * execution has reached a runner.
 *
 * The preview is what a row can show; `statusCounts` is what it can say. Keeping the counts
 * server-side is what lets a row report a failure that sits past the preview. Counts use the
 * display status derived from the job verdict, listener state, and selected execution state;
 * the row keeps the verdict and evidence separate so the client can apply the same display
 * rule as run detail.
 */
export interface WorkflowRunJobsSummary {
  preview: WorkflowRunJobSummary[];
  statusCounts: WorkflowRunJobStatusCount[];
  rawStatusCounts: WorkflowRunJobRawStatusCount[];
  hasStartedJobExecution: boolean;
}

export interface WorkflowRunJobStatusCount {
  status: JobStatus | 'listening';
  count: number;
}

export interface WorkflowRunJobRawStatusCount {
  status: JobStatus;
  count: number;
}

/**
 * Jobs for a page of runs, keyed by run id.
 *
 * Issued once per page rather than once per run: the run list is the one surface that needs
 * every run's jobs at once, and a per-row query would put 50 round trips behind it.
 *
 * Both reads are bounded by the page, not by workflow size. A workflow has no job limit and
 * this list polls while runs are active, so returning every job of every row would let one
 * large workflow decide how much the endpoint moves every four seconds. The preview is cut
 * per run in the database, and everything past it is described by a grouped count instead.
 *
 * The attempt comes from the caller's own read rather than from a second look at
 * `current_attempt`. Re-reading it here would let a re-run landing between the queries pair
 * attempt 1's run metadata with attempt 2's jobs, and the row would report a status its strip
 * contradicts.
 *
 * The reads share one repeatable-read snapshot. They describe the same jobs and executions at
 * the same instant, and the strip combines them into a single glyph row, so under the default
 * read-committed isolation a job settling between the statements would draw a pending glyph
 * beside a summary counting it as failed. Sequential inside one transaction is the cost of
 * that; at a four-second poll the extra round trip does not register.
 */
export async function listWorkflowRunJobSummaries(
  runs: readonly WorkflowRunJobSummaryTarget[],
): Promise<Map<string, WorkflowRunJobsSummary>> {
  const summaries = new Map<string, WorkflowRunJobsSummary>();
  if (runs.length === 0) return summaries;

  // A row-constructor IN over (run, attempt) so each pair is one lookup on the unique index
  // that already covers those two columns.
  const attemptPairs = sql.join(
    runs.map((run) => sql`(${run.id}::uuid, ${run.currentAttempt})`),
    sql`, `,
  );
  const attemptFilter = sql`(${workflowRunAttempts.workflowRunId}, ${workflowRunAttempts.attempt}) in (${attemptPairs})`;

  const {previewRows, countRows} = await db().transaction(
    async (tx) => {
      // Pick the execution the detail view would display once per job before either list
      // statement touches it. The existing (job_id, sequence) index supports the latest
      // execution ordering, while the status-first expression preserves the rule that an
      // active execution wins over a newer completed retry.
      const selectedExecution = tx.$with('selected_execution').as(
        tx
          .selectDistinctOn([jobExecutions.jobId], {
            jobId: jobExecutions.jobId,
            executionStatus: sql<JobExecutionStatus>`${jobExecutions.status}`.as(
              'execution_status',
            ),
          })
          .from(jobExecutions)
          .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
          .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
          .where(attemptFilter)
          .orderBy(
            asc(jobExecutions.jobId),
            sql`case when ${jobExecutions.status} = 'running' then 0 else 1 end`,
            desc(jobExecutions.sequence),
            desc(jobExecutions.id),
          ),
      );

      const ranked = tx
        .with(selectedExecution)
        .select({
          workflowRunId: workflowRunAttempts.workflowRunId,
          id: jobs.id,
          key: jobs.key,
          name: jobs.name,
          status: jobs.status,
          mode: jobs.mode,
          listenerStatus: jobs.listenerStatus,
          executionStatus: selectedExecution.executionStatus,
          position: jobs.position,
          jobRank:
            sql<number>`row_number() over (partition by ${workflowRunAttempts.workflowRunId} order by ${jobs.position} asc, ${jobs.id} asc)`.as(
              'job_rank',
            ),
        })
        .from(jobs)
        .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .leftJoin(selectedExecution, eq(selectedExecution.jobId, jobs.id))
        .where(attemptFilter)
        .as('ranked');
      // Correlated per job rather than a grouped scan of `job_executions`: an aggregate over the
      // whole table cannot have the page's filter pushed into it, so it would read every execution
      // ever recorded on each poll and grow with history rather than with the page.
      const hasStartedJobExecution = sql<boolean>`bool_or(exists (
        select 1
        from ${jobExecutions}
        where ${jobExecutions.jobId} = ${jobs.id} and ${jobExecutions.startedAt} is not null
      ))`;

      const executionDisplayStatus = sql<JobExecutionStatus | null>`
        ${selectedExecution.executionStatus}
      `;
      const displayStatus = sql<WorkflowRunJobStatusCount['status']>`
        case
          when ${jobs.status} in ('succeeded', 'failed', 'cancelled', 'skipped') then ${jobs.status}::text
          when ${jobs.mode} = 'listening' and ${jobs.listenerStatus} = 'listening' then 'listening'
          when ${executionDisplayStatus} is not null then ${executionDisplayStatus}::text
          else 'pending'
        end
      `;
      return {
        previewRows: await tx
          .select({
            workflowRunId: ranked.workflowRunId,
            id: ranked.id,
            key: ranked.key,
            name: ranked.name,
            status: ranked.status,
            mode: ranked.mode,
            listenerStatus: ranked.listenerStatus,
            executionStatus: ranked.executionStatus,
            position: ranked.position,
          })
          .from(ranked)
          .where(lte(ranked.jobRank, WORKFLOW_RUN_JOB_PREVIEW_LIMIT))
          .orderBy(asc(ranked.workflowRunId), asc(ranked.position), asc(ranked.id)),
        countRows: await tx
          .with(selectedExecution)
          .select({
            workflowRunId: workflowRunAttempts.workflowRunId,
            rawStatus: jobs.status,
            status: displayStatus,
            count: count(),
            hasStartedJobExecution,
          })
          .from(jobs)
          .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
          .leftJoin(selectedExecution, eq(selectedExecution.jobId, jobs.id))
          .where(attemptFilter)
          .groupBy(workflowRunAttempts.workflowRunId, jobs.status, displayStatus),
      };
    },
    {isolationLevel: 'repeatable read', accessMode: 'read only'},
  );

  for (const {workflowRunId, ...summary} of previewRows) {
    summaryFor(summaries, workflowRunId).preview.push(summary);
  }
  for (const {
    workflowRunId,
    rawStatus,
    status,
    count: statusCount,
    hasStartedJobExecution,
  } of countRows) {
    const summary = summaryFor(summaries, workflowRunId);
    appendStatusCount(summary.rawStatusCounts, rawStatus, statusCount);
    appendStatusCount(summary.statusCounts, status, statusCount);
    // One row per (run, verdict, display status), so the run's answer is the OR of its groups.
    summary.hasStartedJobExecution ||= hasStartedJobExecution;
  }

  return summaries;
}

function summaryFor(
  summaries: Map<string, WorkflowRunJobsSummary>,
  workflowRunId: string,
): WorkflowRunJobsSummary {
  const existing = summaries.get(workflowRunId);
  if (existing) return existing;
  const created: WorkflowRunJobsSummary = {
    preview: [],
    statusCounts: [],
    rawStatusCounts: [],
    hasStartedJobExecution: false,
  };
  summaries.set(workflowRunId, created);
  return created;
}

function appendStatusCount<T extends string>(
  counts: Array<{status: T; count: number}>,
  status: T,
  count: number,
): void {
  const existing = counts.find((entry) => entry.status === status);
  if (existing) {
    existing.count += count;
  } else {
    counts.push({status, count});
  }
}

export async function listWorkflowRunsByProject(projectId: string): Promise<WorkflowRun[]> {
  const result = await listWorkflowRuns({projectId, limit: 100});
  return result.runs;
}

export async function getWorkflowRunAggregates(params: {
  projectId: string;
  filters?: WorkflowRunFilters | undefined;
}): Promise<WorkflowRunAggregates> {
  const [statusRows, triggerRows, workflowRows] = await Promise.all([
    db()
      .select({value: workflowRuns.status, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'status',
          }),
        ),
      )
      .groupBy(workflowRuns.status),
    db()
      .select({value: workflowRuns.triggerSource, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'triggerSource',
          }),
        ),
      )
      .groupBy(workflowRuns.triggerSource),
    db()
      .select({value: workflowRuns.definitionId, count: count()})
      .from(workflowRuns)
      .where(
        and(
          ...buildWorkflowRunListConditions({
            projectId: params.projectId,
            filters: params.filters,
            omit: 'definitionId',
          }),
        ),
      )
      .groupBy(workflowRuns.definitionId),
  ]);

  return {
    status: statusRows,
    triggerSource: triggerRows,
    workflow: workflowRows,
  };
}

export async function getWorkflowJobExecutionDepth(
  params: WorkflowJobExecutionDepthParams = {},
): Promise<WorkflowJobExecutionDepth> {
  const runConditions = [eq(workflowRuns.status, 'running')];
  const jobConditions = [eq(jobExecutions.status, 'running')];
  if (params.workspaceId) {
    runConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
    jobConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  }

  const [runRows, jobRows] = await Promise.all([
    db()
      .select({value: count()})
      .from(workflowRuns)
      .where(and(...runConditions)),
    db()
      .select({value: count()})
      .from(jobExecutions)
      .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
      .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
      .where(and(...jobConditions)),
  ]);

  return {
    runningRuns: runRows[0]?.value ?? 0,
    runningJobExecutions: jobRows[0]?.value ?? 0,
  };
}

export async function getWorkflowRunDetail(
  workflowRunId: string,
  attempt?: number | undefined,
  workspaceId?: string | undefined,
  options: WorkflowRunDetailReadOptions = {},
): Promise<WorkflowRunDetail | undefined> {
  const startedAt = performance.now();
  let returnedRows = 0;
  let databaseDurationMilliseconds: number | undefined;

  try {
    if (options.diagnosticLimits) {
      const result = await getWorkflowRunDiagnosticDetail({
        workflowRunId,
        attempt,
        workspaceId,
        limits: options.diagnosticLimits,
      });
      returnedRows = result.returnedRows;
      databaseDurationMilliseconds = performance.now() - startedAt;
      return result.detail;
    }

    const targetConditions = [eq(workflowRuns.id, workflowRunId)];
    if (workspaceId) targetConditions.push(eq(workflowRuns.workspaceId, workspaceId));
    const [target] = await db()
      .select({run: workflowRuns, attempt: workflowRunAttempts})
      .from(workflowRuns)
      .innerJoin(
        workflowRunAttempts,
        and(
          eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
          eq(workflowRunAttempts.attempt, attempt ?? workflowRuns.currentAttempt),
        ),
      )
      .where(and(...targetConditions))
      .limit(1);
    if (!target) return undefined;

    const latestAttempt = await getLatestAttempt({
      workflowRunId: target.run.id,
      projectId: target.run.projectId,
    });

    const rows = await db()
      .select({
        run: workflowRuns,
        job: jobs,
        jobExecution: jobExecutions,
        step: steps,
        stepAttempt: stepAttempts,
      })
      .from(workflowRuns)
      .innerJoin(workflowRunAttempts, eq(workflowRunAttempts.id, target.attempt.id))
      .leftJoin(jobs, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
      .leftJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
      .leftJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
      .leftJoin(stepAttempts, eq(stepAttempts.stepId, steps.id))
      .where(and(...targetConditions))
      .orderBy(
        asc(jobs.position),
        asc(jobs.id),
        asc(jobExecutions.sequence),
        asc(jobExecutions.id),
        asc(steps.position),
        asc(steps.id),
        asc(stepAttempts.executionOrder),
        asc(stepAttempts.id),
      );
    returnedRows = rows.length;
    databaseDurationMilliseconds = performance.now() - startedAt;

    return hydrateWorkflowRunDetail(rows, target.attempt, latestAttempt);
  } finally {
    try {
      options.onRead?.({
        databaseDurationMilliseconds: databaseDurationMilliseconds ?? performance.now() - startedAt,
        returnedRows,
      });
    } catch {
      // Measurement observers must not change the legacy read outcome.
    }
  }
}

export async function getJobExecutionDetail(
  jobExecutionId: string,
): Promise<JobExecutionDetail | undefined> {
  const rows = await db()
    .select({
      job: jobs,
      jobExecution: jobExecutions,
      step: steps,
      stepAttempt: stepAttempts,
    })
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .leftJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
    .leftJoin(stepAttempts, eq(stepAttempts.stepId, steps.id))
    .where(eq(jobExecutions.id, jobExecutionId))
    .orderBy(
      asc(steps.position),
      asc(steps.id),
      asc(stepAttempts.executionOrder),
      asc(stepAttempts.id),
    );

  const first = rows[0];
  if (!first) return undefined;

  const detail: JobExecutionDetail = {
    ...toJobExecution(first.jobExecution, first.job.name ?? first.job.key),
    steps: [],
  };
  const stepById = new Map<string, StepDetail>();
  for (const row of rows) {
    if (row.step) {
      const step = getOrCreateStepDetail(stepById, detail.steps, row.step);
      if (row.stepAttempt) {
        step.attempts.push(toStepAttempt(row.stepAttempt));
      }
    }
  }

  return detail;
}

function hydrateWorkflowRunDetail(
  rows: {
    run: typeof workflowRuns.$inferSelect;
    job: typeof jobs.$inferSelect | null;
    jobExecution: typeof jobExecutions.$inferSelect | null;
    step: typeof steps.$inferSelect | null;
    stepAttempt: typeof stepAttempts.$inferSelect | null;
  }[],
  attempt: typeof workflowRunAttempts.$inferSelect,
  latestAttempt: number,
): WorkflowRunDetail | undefined {
  const first = rows[0];
  if (!first) return undefined;

  const detail: WorkflowRunDetail = {
    ...toWorkflowRun(first.run),
    runAttempt: toWorkflowRunAttempt(attempt),
    latestAttempt,
    jobs: [],
    // Read off the same rows the executions come from, so the flag cannot contradict them.
    hasStartedJobExecution: rows.some((row) => row.jobExecution?.startedAt != null),
  };
  const jobById = new Map<string, WorkflowJobDetail>();
  const jobExecutionById = new Map<string, JobExecutionDetail>();
  const stepById = new Map<string, StepDetail>();

  for (const row of rows) {
    if (!row.job) continue;
    let job = jobById.get(row.job.id);
    if (!job) {
      job = {...toJob(row.job), jobExecutions: []};
      jobById.set(row.job.id, job);
      detail.jobs.push(job);
    }

    if (!row.jobExecution) continue;
    let jobExecution = jobExecutionById.get(row.jobExecution.id);
    if (!jobExecution) {
      jobExecution = {
        ...toJobExecution(row.jobExecution, row.job.name ?? row.job.key),
        steps: [],
      };
      jobExecutionById.set(row.jobExecution.id, jobExecution);
      job.jobExecutions.push(jobExecution);
    }

    if (!row.step) continue;
    const step = getOrCreateStepDetail(stepById, jobExecution.steps, row.step);
    if (row.stepAttempt) {
      step.attempts.push(toStepAttempt(row.stepAttempt));
    }
  }

  return detail;
}

function getOrCreateStepDetail(
  stepById: Map<string, StepDetail>,
  target: StepDetail[],
  row: typeof steps.$inferSelect,
): StepDetail {
  let step = stepById.get(row.id);
  if (!step) {
    step = {...toStep(row), attempts: []};
    stepById.set(row.id, step);
    target.push(step);
  }
  return step;
}
