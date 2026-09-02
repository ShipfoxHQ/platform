import type {WorkflowRunDiagnosticReadLimits} from '@shipfox/api-workflows-dto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  lte,
  sql,
} from 'drizzle-orm';
import type {JobStatus} from '#core/entities/job.js';
import type {
  JobExecutionDetail,
  StepDetail,
  WorkflowJobDetail,
  WorkflowRunDetail,
} from '#core/entities/workflow-run.js';
import {db, type Tx} from '../db.js';
import {jobExecutions, toJobExecution} from '../schema/job-executions.js';
import {jobs, toJob} from '../schema/jobs.js';
import {stepAttempts, toStepAttempt} from '../schema/step-attempts.js';
import {steps, toStep} from '../schema/steps.js';
import {toWorkflowRunAttempt, workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';

export interface WorkflowRunDiagnosticDetailReadParams {
  workflowRunId: string;
  attempt?: number | undefined;
  workspaceId?: string | undefined;
  limits: WorkflowRunDiagnosticReadLimits;
}

export interface WorkflowRunDiagnosticDetailReadResult {
  detail: WorkflowRunDetail | undefined;
  returnedRows: number;
}

type DiagnosticJobRow = Awaited<ReturnType<typeof readBoundedJobs>>[number];
type DiagnosticExecutionRow = Awaited<ReturnType<typeof readBoundedExecutions>>[number];
type DiagnosticStepRow = Awaited<ReturnType<typeof readBoundedSteps>>[number];
type DiagnosticAttemptRow = Awaited<ReturnType<typeof readBoundedStepAttempts>>[number];

interface DiagnosticRows {
  jobRows: DiagnosticJobRow[];
  executionRows: DiagnosticExecutionRow[];
  stepRows: DiagnosticStepRow[];
  attemptRows: DiagnosticAttemptRow[];
  jobStatusRows: Array<{status: JobStatus; count: number}>;
  startedExecutionRows: Array<{id: string}>;
}

/**
 * Reads the diagnostic projection with a bounded query at every relationship level. The
 * `row_number` windows retain the same deterministic order as the diagnostic consumer while
 * `count(*) over` carries exact totals without materializing the omitted history.
 */
export function getWorkflowRunDiagnosticDetail(
  params: WorkflowRunDiagnosticDetailReadParams,
): Promise<WorkflowRunDiagnosticDetailReadResult> {
  return db().transaction((tx) => readWorkflowRunDiagnosticDetail(tx, params), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  });
}

async function readWorkflowRunDiagnosticDetail(
  tx: Tx,
  params: WorkflowRunDiagnosticDetailReadParams,
): Promise<WorkflowRunDiagnosticDetailReadResult> {
  const target = await readDiagnosticTarget(tx, params);
  if (!target) return {detail: undefined, returnedRows: 0};

  const latestAttempt = await readLatestAttempt(tx, target.run.id, target.run.projectId);
  const rows = await readDiagnosticRows(tx, target.attempt.id, params.limits);
  const detail = assembleDiagnosticDetail(target, latestAttempt, rows, params.limits);

  return {
    detail,
    returnedRows:
      1 +
      rows.jobRows.length +
      rows.executionRows.length +
      rows.stepRows.length +
      rows.attemptRows.length +
      rows.jobStatusRows.length +
      rows.startedExecutionRows.length,
  };
}

async function readDiagnosticTarget(tx: Tx, params: WorkflowRunDiagnosticDetailReadParams) {
  const targetConditions = [eq(workflowRuns.id, params.workflowRunId)];
  if (params.workspaceId) targetConditions.push(eq(workflowRuns.workspaceId, params.workspaceId));
  const [target] = await tx
    .select({run: workflowRuns, attempt: workflowRunAttempts})
    .from(workflowRuns)
    .innerJoin(
      workflowRunAttempts,
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRuns.id),
        eq(workflowRunAttempts.attempt, params.attempt ?? workflowRuns.currentAttempt),
      ),
    )
    .where(and(...targetConditions))
    .limit(1);
  return target;
}

async function readLatestAttempt(
  tx: Tx,
  workflowRunId: string,
  projectId: string,
): Promise<number> {
  const [row] = await tx
    .select({value: sql<number>`coalesce(max(${workflowRunAttempts.attempt}), 1)`})
    .from(workflowRunAttempts)
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(
      and(
        eq(workflowRunAttempts.workflowRunId, workflowRunId),
        eq(workflowRuns.projectId, projectId),
      ),
    )
    .limit(1);
  return Number(row?.value ?? 1);
}

async function readDiagnosticRows(
  tx: Tx,
  workflowRunAttemptId: string,
  limits: WorkflowRunDiagnosticReadLimits,
): Promise<DiagnosticRows> {
  const jobRows = await readBoundedJobs(tx, workflowRunAttemptId, limits.jobs);
  const executionRows =
    jobRows.length === 0
      ? []
      : await readBoundedExecutions(
          tx,
          jobRows.map((row) => row.id),
          limits.executions,
        );
  const stepRows =
    executionRows.length === 0
      ? []
      : await readBoundedSteps(
          tx,
          executionRows.map((row) => row.id),
          limits.steps,
        );
  const attemptRows =
    stepRows.length === 0
      ? []
      : await readBoundedStepAttempts(
          tx,
          stepRows.map((row) => row.id),
          limits.attempts,
        );
  const jobStatusRows = await tx
    .select({status: jobs.status, count: count()})
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .groupBy(jobs.status);
  const startedExecutionRows = await tx
    .select({id: jobExecutions.id})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(
      and(eq(jobs.workflowRunAttemptId, workflowRunAttemptId), isNotNull(jobExecutions.startedAt)),
    )
    .limit(1);
  return {
    jobRows,
    executionRows,
    stepRows,
    attemptRows,
    jobStatusRows: jobStatusRows.map(({status, count: statusCount}) => ({
      status: status as JobStatus,
      count: Number(statusCount),
    })),
    startedExecutionRows,
  };
}

function assembleDiagnosticDetail(
  target: {
    run: typeof workflowRuns.$inferSelect;
    attempt: typeof workflowRunAttempts.$inferSelect;
  },
  latestAttempt: number,
  rows: DiagnosticRows,
  limits: WorkflowRunDiagnosticReadLimits,
): WorkflowRunDetail {
  const executionTotalCounts = totalCountsByParent(rows.executionRows, (row) => row.jobId);
  const stepTotalCounts = totalCountsByParent(rows.stepRows, (row) => row.jobExecutionId);
  const attemptTotalCounts = totalCountsByParent(rows.attemptRows, (row) => row.stepId);
  const jobById = createDiagnosticJobs(rows.jobRows);
  const executionById = attachDiagnosticExecutions(
    jobById,
    rows.executionRows,
    executionTotalCounts,
    limits.executions,
  );
  const stepById = attachDiagnosticSteps(
    executionById,
    rows.stepRows,
    stepTotalCounts,
    limits.steps,
  );
  attachDiagnosticAttempts(stepById, rows.attemptRows, attemptTotalCounts, limits.attempts);
  const jobDetails = rows.jobRows.map((row) => jobById.get(row.id)).filter(isDefined);
  const detail: WorkflowRunDetail = {
    ...toWorkflowRun(target.run),
    runAttempt: toWorkflowRunAttempt(target.attempt),
    latestAttempt,
    jobs: jobDetails,
    hasStartedJobExecution: rows.startedExecutionRows.length > 0,
    jobStatusCounts: rows.jobStatusRows,
  };
  const jobTotalCount = Number(rows.jobRows[0]?.totalCount ?? 0);
  if (jobTotalCount > limits.jobs) detail.jobsTotalCount = jobTotalCount;
  return detail;
}

function readBoundedJobs(tx: Tx, workflowRunAttemptId: string, limit: number) {
  const ranked = tx
    .select({
      ...getTableColumns(jobs),
      rowNumber: sql<number>`row_number() over (
        order by ${jobs.position} asc, ${jobs.id} asc
      )`.as('row_number'),
      totalCount: sql<number>`count(*) over ()`.as('total_count'),
    })
    .from(jobs)
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .as('diagnostic_jobs');
  return tx
    .select()
    .from(ranked)
    .where(lte(ranked.rowNumber, limit))
    .orderBy(asc(ranked.rowNumber));
}

function createDiagnosticJobs(rows: readonly DiagnosticJobRow[]): Map<string, WorkflowJobDetail> {
  const jobById = new Map<string, WorkflowJobDetail>();
  for (const row of rows) {
    const job: WorkflowJobDetail = {...toJob(row), jobExecutions: []};
    jobById.set(job.id, job);
  }
  return jobById;
}

function attachDiagnosticExecutions(
  jobById: ReadonlyMap<string, WorkflowJobDetail>,
  rows: readonly DiagnosticExecutionRow[],
  totalCounts: ReadonlyMap<string, number>,
  limit: number,
): Map<string, JobExecutionDetail> {
  const executionById = new Map<string, JobExecutionDetail>();
  for (const row of rows) {
    const job = jobById.get(row.jobId);
    if (!job) continue;
    const execution: JobExecutionDetail = {...toJobExecution(row, job.name ?? job.key), steps: []};
    executionById.set(execution.id, execution);
    job.jobExecutions.push(execution);
    const totalCount = totalCounts.get(row.jobId) ?? 0;
    if (totalCount > limit) job.jobExecutionsTotalCount = totalCount;
  }
  return executionById;
}

function attachDiagnosticSteps(
  executionById: ReadonlyMap<string, JobExecutionDetail>,
  rows: readonly DiagnosticStepRow[],
  totalCounts: ReadonlyMap<string, number>,
  limit: number,
): Map<string, StepDetail> {
  const stepById = new Map<string, StepDetail>();
  for (const row of rows) {
    const execution = executionById.get(row.jobExecutionId);
    if (!execution) continue;
    const step: StepDetail = {...toStep(row), attempts: []};
    stepById.set(step.id, step);
    execution.steps.push(step);
    const totalCount = totalCounts.get(row.jobExecutionId) ?? 0;
    if (totalCount > limit) execution.stepsTotalCount = totalCount;
  }
  return stepById;
}

function attachDiagnosticAttempts(
  stepById: ReadonlyMap<string, StepDetail>,
  rows: readonly DiagnosticAttemptRow[],
  totalCounts: ReadonlyMap<string, number>,
  limit: number,
): void {
  for (const row of rows) {
    const step = stepById.get(row.stepId);
    if (!step) continue;
    step.attempts.push(toStepAttempt(row));
    const totalCount = totalCounts.get(row.stepId) ?? 0;
    if (totalCount > limit) step.attemptsTotalCount = totalCount;
  }
}

function readBoundedExecutions(tx: Tx, jobIds: readonly string[], limit: number) {
  const ranked = tx
    .select({
      ...getTableColumns(jobExecutions),
      rowNumber: sql<number>`row_number() over (
        partition by ${jobExecutions.jobId}
        order by ${jobExecutions.sequence} desc, ${jobExecutions.id} asc
      )`.as('row_number'),
      totalCount: sql<number>`count(*) over (partition by ${jobExecutions.jobId})`.as(
        'total_count',
      ),
    })
    .from(jobExecutions)
    .where(inArray(jobExecutions.jobId, jobIds))
    .as('diagnostic_executions');
  return tx
    .select()
    .from(ranked)
    .where(lte(ranked.rowNumber, limit))
    .orderBy(asc(ranked.jobId), asc(ranked.rowNumber));
}

function readBoundedSteps(tx: Tx, executionIds: readonly string[], limit: number) {
  const ranked = tx
    .select({
      ...getTableColumns(steps),
      rowNumber: sql<number>`row_number() over (
        partition by ${steps.jobExecutionId}
        order by ${steps.position} asc, ${steps.id} asc
      )`.as('row_number'),
      totalCount: sql<number>`count(*) over (partition by ${steps.jobExecutionId})`.as(
        'total_count',
      ),
    })
    .from(steps)
    .where(inArray(steps.jobExecutionId, executionIds))
    .as('diagnostic_steps');
  return tx
    .select()
    .from(ranked)
    .where(lte(ranked.rowNumber, limit))
    .orderBy(asc(ranked.jobExecutionId), asc(ranked.rowNumber));
}

function readBoundedStepAttempts(tx: Tx, stepIds: readonly string[], limit: number) {
  const ranked = tx
    .select({
      ...getTableColumns(stepAttempts),
      rowNumber: sql<number>`row_number() over (
        partition by ${stepAttempts.stepId}
        order by ${stepAttempts.attempt} desc, ${stepAttempts.id} asc
      )`.as('row_number'),
      totalCount: sql<number>`count(*) over (partition by ${stepAttempts.stepId})`.as(
        'total_count',
      ),
    })
    .from(stepAttempts)
    .where(inArray(stepAttempts.stepId, stepIds))
    .as('diagnostic_step_attempts');
  return tx
    .select()
    .from(ranked)
    .where(lte(ranked.rowNumber, limit))
    .orderBy(asc(ranked.stepId), desc(ranked.rowNumber));
}

function totalCountsByParent<T>(
  rows: readonly T[],
  parent: (row: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = parent(row);
    if (!counts.has(key)) {
      const totalCount = Number((row as T & {totalCount: number}).totalCount);
      counts.set(key, totalCount);
    }
  }
  return counts;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
