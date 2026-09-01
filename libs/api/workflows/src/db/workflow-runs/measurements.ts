import {asc, count, eq, sql} from 'drizzle-orm';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';

export interface MeasurementValueCount {
  value: string | null;
  count: number;
}

export interface WorkflowRunDetailCardinality {
  jobs: number;
  dependencyEdges: number;
  executions: number;
  steps: number;
  stepAttempts: number;
  legacyJoinedRows: number;
}

export interface WorkflowRunStorageAudit {
  executionStatusReasons: MeasurementValueCount[];
  stepTypes: MeasurementValueCount[];
  stepStatuses: MeasurementValueCount[];
  stepAttemptStatuses: MeasurementValueCount[];
  maximumInvocationArrayLength: number;
}

export type WorkflowRunStorageAuditOptions =
  | {workflowRunAttemptId: string}
  | {scope: 'all'; allowFullTableScan: true};

export interface WorkflowRunReadPlanEvidence {
  analyzed: boolean;
  defaultExecutionSelection: unknown;
  executionStatusCounts: unknown;
}

export interface WorkflowRunDetailMeasurementReport {
  cardinality: WorkflowRunDetailCardinality;
  storage: WorkflowRunStorageAudit;
  queryPlans: WorkflowRunReadPlanEvidence;
}

/**
 * Counts only workflow-owned scalar rows and the number of dependency-array entries. It is
 * intentionally separate from the legacy detail query so a measurement report does not load
 * source, input, output, trace, event, response, error, annotation, or log content.
 */
export async function measureWorkflowRunDetailCardinality(
  workflowRunAttemptId: string,
): Promise<WorkflowRunDetailCardinality> {
  const [jobRows, dependencyRows, executionRows, stepRows, stepAttemptRows, joinedRows] =
    await Promise.all([
      db()
        .select({value: count()})
        .from(jobs)
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId)),
      db()
        .select({value: sql<number>`coalesce(sum(jsonb_array_length(${jobs.dependencies})), 0)`})
        .from(jobs)
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId)),
      db()
        .select({value: count()})
        .from(jobExecutions)
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId)),
      db()
        .select({value: count()})
        .from(steps)
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId)),
      db()
        .select({value: count()})
        .from(stepAttempts)
        .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId)),
      db()
        .select({value: count()})
        .from(workflowRuns)
        .innerJoin(workflowRunAttempts, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
        .leftJoin(jobs, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
        .leftJoin(jobExecutions, eq(jobExecutions.jobId, jobs.id))
        .leftJoin(steps, eq(steps.jobExecutionId, jobExecutions.id))
        .leftJoin(stepAttempts, eq(stepAttempts.stepId, steps.id))
        .where(eq(workflowRunAttempts.id, workflowRunAttemptId)),
    ]);

  return {
    jobs: scalarNumber(jobRows[0]?.value),
    dependencyEdges: scalarNumber(dependencyRows[0]?.value),
    executions: scalarNumber(executionRows[0]?.value),
    steps: scalarNumber(stepRows[0]?.value),
    stepAttempts: scalarNumber(stepAttemptRows[0]?.value),
    legacyJoinedRows: scalarNumber(joinedRows[0]?.value),
  };
}

/**
 * Audits the stored vocabulary and array cardinality without selecting any diagnostic JSON or
 * text. Attempt-scoped audits are the default operation. A complete-table production baseline
 * requires the explicit `scope: 'all'` and `allowFullTableScan: true` opt-in and must stay out of
 * request paths.
 */
export async function auditWorkflowRunStorage(
  params: WorkflowRunStorageAuditOptions,
): Promise<WorkflowRunStorageAudit> {
  const hasAttemptScope =
    typeof params === 'object' &&
    params !== null &&
    'workflowRunAttemptId' in params &&
    typeof params.workflowRunAttemptId === 'string' &&
    params.workflowRunAttemptId.length > 0;
  const hasFullTableScanOptIn =
    typeof params === 'object' &&
    params !== null &&
    'scope' in params &&
    params.scope === 'all' &&
    params.allowFullTableScan === true;

  if (!hasAttemptScope && !hasFullTableScanOptIn) {
    throw new Error(
      'Workflow-run storage audits require an attempt id or explicit full-table-scan opt-in',
    );
  }

  const workflowRunAttemptId = hasAttemptScope ? params.workflowRunAttemptId : undefined;
  const [executionStatusReasons, stepTypes, stepStatuses, stepAttemptStatuses, invocationRows] =
    await Promise.all([
      auditExecutionStatusReasons(workflowRunAttemptId),
      auditStepTypes(workflowRunAttemptId),
      auditStepStatuses(workflowRunAttemptId),
      auditStepAttemptStatuses(workflowRunAttemptId),
      auditInvocationLength(workflowRunAttemptId),
    ]);

  return {
    executionStatusReasons,
    stepTypes,
    stepStatuses,
    stepAttemptStatuses,
    maximumInvocationArrayLength: scalarNumber(invocationRows[0]?.value),
  };
}

/**
 * Captures safe JSON-format plans for the two history-dependent reads called out by the
 * bounded-read design. `ANALYZE` is opt-in because it executes the statements; both forms are
 * read-only and contain plan metadata rather than row payloads.
 */
export async function captureWorkflowRunReadPlanEvidence(params: {
  workflowRunAttemptId: string;
  analyze?: boolean | undefined;
}): Promise<WorkflowRunReadPlanEvidence> {
  const explainPrefix = params.analyze
    ? sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) `
    : sql`EXPLAIN (FORMAT JSON) `;
  const jobAttemptId = params.workflowRunAttemptId;

  const defaultExecutionSelection = sql`
    SELECT DISTINCT ON (${jobExecutions.jobId})
      ${jobExecutions.jobId},
      ${jobExecutions.id},
      ${jobExecutions.status},
      ${jobExecutions.sequence}
    FROM ${jobExecutions}
    INNER JOIN ${jobs}
      ON ${jobs.id} = ${jobExecutions.jobId}
    WHERE ${jobs.workflowRunAttemptId} = ${jobAttemptId}::uuid
    ORDER BY
      ${jobExecutions.jobId},
      CASE WHEN ${jobExecutions.status} = 'running' THEN 0 ELSE 1 END,
      ${jobExecutions.sequence} DESC,
      ${jobExecutions.id} DESC
  `;
  const executionStatusCounts = sql`
    SELECT ${jobExecutions.status}, count(*)::integer AS execution_count
    FROM ${jobExecutions}
    INNER JOIN ${jobs}
      ON ${jobs.id} = ${jobExecutions.jobId}
    WHERE ${jobs.workflowRunAttemptId} = ${jobAttemptId}::uuid
    GROUP BY ${jobExecutions.status}
    ORDER BY ${jobExecutions.status}
  `;

  const [defaultSelectionRows, statusCountRows] = await Promise.all([
    db().execute(sql`${explainPrefix}${defaultExecutionSelection}`),
    db().execute(sql`${explainPrefix}${executionStatusCounts}`),
  ]);

  return {
    analyzed: params.analyze === true,
    defaultExecutionSelection: explainPlan(defaultSelectionRows),
    executionStatusCounts: explainPlan(statusCountRows),
  };
}

export async function measureWorkflowRunDetail(params: {
  workflowRunAttemptId: string;
  analyze?: boolean | undefined;
}): Promise<WorkflowRunDetailMeasurementReport> {
  const [cardinality, storage, queryPlans] = await Promise.all([
    measureWorkflowRunDetailCardinality(params.workflowRunAttemptId),
    auditWorkflowRunStorage({workflowRunAttemptId: params.workflowRunAttemptId}),
    captureWorkflowRunReadPlanEvidence(params),
  ]);

  return {cardinality, storage, queryPlans};
}

async function auditExecutionStatusReasons(
  workflowRunAttemptId: string | undefined,
): Promise<MeasurementValueCount[]> {
  const rows = workflowRunAttemptId
    ? await db()
        .select({value: jobExecutions.statusReason, count: count()})
        .from(jobExecutions)
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
        .groupBy(jobExecutions.statusReason)
        .orderBy(asc(jobExecutions.statusReason))
    : await db()
        .select({value: jobExecutions.statusReason, count: count()})
        .from(jobExecutions)
        .groupBy(jobExecutions.statusReason)
        .orderBy(asc(jobExecutions.statusReason));
  return valueCounts(rows);
}

async function auditStepTypes(
  workflowRunAttemptId: string | undefined,
): Promise<MeasurementValueCount[]> {
  const rows = workflowRunAttemptId
    ? await db()
        .select({value: steps.type, count: count()})
        .from(steps)
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
        .groupBy(steps.type)
        .orderBy(asc(steps.type))
    : await db()
        .select({value: steps.type, count: count()})
        .from(steps)
        .groupBy(steps.type)
        .orderBy(asc(steps.type));
  return valueCounts(rows);
}

async function auditStepStatuses(
  workflowRunAttemptId: string | undefined,
): Promise<MeasurementValueCount[]> {
  const rows = workflowRunAttemptId
    ? await db()
        .select({value: steps.status, count: count()})
        .from(steps)
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
        .groupBy(steps.status)
        .orderBy(asc(steps.status))
    : await db()
        .select({value: steps.status, count: count()})
        .from(steps)
        .groupBy(steps.status)
        .orderBy(asc(steps.status));
  return valueCounts(rows);
}

async function auditStepAttemptStatuses(
  workflowRunAttemptId: string | undefined,
): Promise<MeasurementValueCount[]> {
  const rows = workflowRunAttemptId
    ? await db()
        .select({value: stepAttempts.status, count: count()})
        .from(stepAttempts)
        .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
        .groupBy(stepAttempts.status)
        .orderBy(asc(stepAttempts.status))
    : await db()
        .select({value: stepAttempts.status, count: count()})
        .from(stepAttempts)
        .groupBy(stepAttempts.status)
        .orderBy(asc(stepAttempts.status));
  return valueCounts(rows);
}

async function auditInvocationLength(workflowRunAttemptId: string | undefined) {
  const rows = workflowRunAttemptId
    ? await db()
        .select({
          value: sql<number>`coalesce(max(jsonb_array_length(${stepAttempts.invocations})), 0)`,
        })
        .from(stepAttempts)
        .innerJoin(steps, eq(stepAttempts.stepId, steps.id))
        .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
        .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
        .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    : await db()
        .select({
          value: sql<number>`coalesce(max(jsonb_array_length(${stepAttempts.invocations})), 0)`,
        })
        .from(stepAttempts);
  return rows;
}

function valueCounts(
  rows: readonly {value: string | null; count: number}[],
): MeasurementValueCount[] {
  return rows.map((row) => ({value: row.value, count: Number(row.count)}));
}

function scalarNumber(value: unknown): number {
  return Number(value ?? 0);
}

function explainPlan(result: unknown): unknown {
  if (!result || typeof result !== 'object' || !('rows' in result)) return null;
  const rows = result.rows;
  if (!Array.isArray(rows)) return null;
  const first = rows[0];
  if (!first || typeof first !== 'object' || !('QUERY PLAN' in first)) return null;
  return first['QUERY PLAN'];
}
