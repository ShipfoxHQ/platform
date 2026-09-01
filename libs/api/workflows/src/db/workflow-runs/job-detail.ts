import {
  JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH,
  WORKFLOW_JOB_STEP_PAGE_LIMIT,
  WORKFLOW_RUN_EXECUTION_COUNT_LIMIT,
  WORKFLOW_STEP_ATTEMPT_PREVIEW_LIMIT,
} from '@shipfox/api-workflows-dto';
import {and, asc, count, desc, eq, gt, inArray, lt, lte, or, sql} from 'drizzle-orm';
import {type JobStatusReason, toJobStatusReason} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import {
  type StepAttemptStatus,
  type StepSourceLocation,
  type StepStatus,
  type StepStatusReason,
  type StepType,
  toStepStatusReason,
} from '#core/entities/step.js';
import {db, type Tx} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import {
  type BoundedExecutionCount,
  getWorkflowRunJobOverview,
  type WorkflowRunJobExecutionSummary,
  type WorkflowRunJobOverview,
} from './overview.js';

export interface WorkflowJobReadScope {
  workflowRunId: string;
  projectId: string;
}

export interface WorkflowStepReadScope extends WorkflowJobReadScope {
  jobId: string;
  jobExecutionId: string;
}

export interface WorkflowJobReadMeasurement {
  databaseDurationMilliseconds: number;
  returnedRows: number;
}

export interface WorkflowJobReadOptions {
  onRead?: ((measurement: WorkflowJobReadMeasurement) => void) | undefined;
}

export interface WorkflowJobDetailRead {
  workflowRunId: string;
  workflowRunAttempt: number;
  job: WorkflowRunJobOverview;
  selectedExecution: WorkflowJobExecutionDetailRead | null;
}

export interface WorkflowJobExecutionDetailRead extends WorkflowRunJobExecutionSummary {
  hasContext: boolean;
  steps: WorkflowStepPageRead;
}

export interface WorkflowStepSummaryRead {
  id: string;
  key: string | null;
  name: string;
  type: StepType;
  position: number;
  status: StepStatus;
  statusReason: StepStatusReason | null;
  sourceLocation: StepSourceLocation | null;
  currentAttempt: number;
  error: Record<string, unknown> | null;
  attempts: {
    items: WorkflowStepAttemptSummaryRead[];
    nextCursor: WorkflowStepAttemptCursor | null;
    total: number;
  };
}

export interface WorkflowStepAttemptSummaryRead {
  id: string;
  attempt: number;
  executionOrder: number;
  status: StepAttemptStatus;
  exitCode: number | null;
  startedAt: Date;
  finishedAt: Date | null;
  error: Record<string, unknown> | null;
  gateResult: Record<string, unknown> | null;
}

export interface WorkflowStepPageRead {
  items: WorkflowStepSummaryRead[];
  nextCursor: WorkflowStepCursor | null;
  total: number | undefined;
}

export interface WorkflowJobExecutionPageRead {
  items: WorkflowRunJobExecutionSummary[];
  nextCursor: WorkflowJobExecutionCursor | null;
  total: BoundedExecutionCount | undefined;
}

export interface WorkflowStepAttemptPageRead {
  items: WorkflowStepAttemptSummaryRead[];
  nextCursor: WorkflowStepAttemptCursor | null;
  total: number | undefined;
  stepType: StepType;
}

export interface WorkflowJobExecutionCursor {
  sequence: number;
  id: string;
}

export interface WorkflowStepCursor {
  position: number;
  id: string;
}

export interface WorkflowStepAttemptCursor {
  attempt: number;
  id: string;
}

export async function getWorkflowJobReadScope(
  jobId: string,
): Promise<WorkflowJobReadScope | undefined> {
  const [row] = await db()
    .select({workflowRunId: workflowRuns.id, projectId: workflowRuns.projectId})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row;
}

export async function getWorkflowStepReadScope(
  stepId: string,
): Promise<WorkflowStepReadScope | undefined> {
  const [row] = await db()
    .select({
      workflowRunId: workflowRuns.id,
      projectId: workflowRuns.projectId,
      jobId: jobs.id,
      jobExecutionId: jobExecutions.id,
    })
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(steps.id, stepId))
    .limit(1);
  return row;
}

export function getWorkflowJobDetail(
  params: {jobId: string; executionId?: string | undefined},
  options: WorkflowJobReadOptions = {},
): Promise<WorkflowJobDetailRead | undefined> {
  return withReadMeasurement(options, async (recordRows) =>
    db().transaction((tx) => readWorkflowJobDetail(tx, params, recordRows), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    }),
  );
}

export function listWorkflowJobExecutionSummaries(
  params: {
    jobId: string;
    limit: number;
    cursor?: WorkflowJobExecutionCursor | undefined;
  },
  options: WorkflowJobReadOptions = {},
): Promise<WorkflowJobExecutionPageRead | undefined> {
  return withReadMeasurement(options, async (recordRows) =>
    db().transaction((tx) => readWorkflowJobExecutionSummaries(tx, params, recordRows), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    }),
  );
}

export function listWorkflowExecutionSteps(
  params: {
    jobId: string;
    executionId: string;
    limit: number;
    cursor?: WorkflowStepCursor | undefined;
  },
  options: WorkflowJobReadOptions = {},
): Promise<WorkflowStepPageRead | undefined> {
  return withReadMeasurement(options, async (recordRows) =>
    db().transaction((tx) => readWorkflowExecutionSteps(tx, params, recordRows), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    }),
  );
}

export function listWorkflowStepAttemptSummaries(
  params: {
    stepId: string;
    limit: number;
    cursor?: WorkflowStepAttemptCursor | undefined;
  },
  options: WorkflowJobReadOptions = {},
): Promise<WorkflowStepAttemptPageRead | undefined> {
  return withReadMeasurement(options, async (recordRows) =>
    db().transaction((tx) => readWorkflowStepAttemptSummaries(tx, params, recordRows), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    }),
  );
}

async function readWorkflowJobDetail(
  tx: Tx,
  params: {jobId: string; executionId?: string | undefined},
  recordRows: (count: number) => void,
): Promise<WorkflowJobDetailRead | undefined> {
  const target = await loadJobDetailTarget(tx, params.jobId);
  recordRows(target ? 1 : 0);
  if (!target) return undefined;

  const job = await getWorkflowRunJobOverview(tx, {
    workflowRunAttemptId: target.workflowRunAttemptId,
    jobId: params.jobId,
  });
  recordRows(job ? 1 : 0);
  if (!job) return undefined;

  const selectedExecutionId = params.executionId ?? job.defaultExecution?.id;
  if (!selectedExecutionId) return toJobDetailRead(target, job, null);

  const execution = await loadExecutionProjection(tx, params.jobId, selectedExecutionId);
  recordRows(execution ? 1 : 0);
  if (!execution) return params.executionId ? undefined : toJobDetailRead(target, job, null);

  const steps = await loadStepPage(tx, execution.id, {
    limit: WORKFLOW_JOB_STEP_PAGE_LIMIT,
    cursor: undefined,
    recordRows,
  });
  return toJobDetailRead(target, job, {
    ...toExecutionSummary(execution),
    hasContext: execution.hasContext,
    steps,
  });
}

async function readWorkflowJobExecutionSummaries(
  tx: Tx,
  params: {
    jobId: string;
    limit: number;
    cursor?: WorkflowJobExecutionCursor | undefined;
  },
  recordRows: (count: number) => void,
): Promise<WorkflowJobExecutionPageRead | undefined> {
  const target = await loadJobDetailTarget(tx, params.jobId);
  recordRows(target ? 1 : 0);
  if (!target) return undefined;

  const rows = await loadExecutionPageRows(tx, params, recordRows);
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);
  const total =
    params.cursor === undefined
      ? await countJobExecutions(tx, params.jobId, recordRows)
      : undefined;

  return {
    items: pageRows.map(toExecutionSummary),
    nextCursor: hasMore && last ? {sequence: last.sequence, id: last.id} : null,
    total: total === undefined ? undefined : boundedExecutionCount(total),
  };
}

async function readWorkflowExecutionSteps(
  tx: Tx,
  params: {
    jobId: string;
    executionId: string;
    limit: number;
    cursor?: WorkflowStepCursor | undefined;
  },
  recordRows: (count: number) => void,
): Promise<WorkflowStepPageRead | undefined> {
  const target = await loadJobDetailTarget(tx, params.jobId);
  recordRows(target ? 1 : 0);
  if (!target) return undefined;

  const [execution] = await tx
    .select({id: jobExecutions.id})
    .from(jobExecutions)
    .where(and(eq(jobExecutions.id, params.executionId), eq(jobExecutions.jobId, params.jobId)))
    .limit(1);
  recordRows(execution ? 1 : 0);
  if (!execution) return undefined;

  return loadStepPage(tx, execution.id, {
    limit: params.limit,
    cursor: params.cursor,
    recordRows,
  });
}

async function readWorkflowStepAttemptSummaries(
  tx: Tx,
  params: {
    stepId: string;
    limit: number;
    cursor?: WorkflowStepAttemptCursor | undefined;
  },
  recordRows: (count: number) => void,
): Promise<WorkflowStepAttemptPageRead | undefined> {
  const [step] = await tx
    .select({id: steps.id, type: steps.type})
    .from(steps)
    .where(eq(steps.id, params.stepId))
    .limit(1);
  recordRows(step ? 1 : 0);
  if (!step) return undefined;

  const rows = await loadStepAttemptPageRows(tx, params, recordRows);
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);
  const total =
    params.cursor === undefined
      ? await countStepAttemptsForRead(tx, params.stepId, recordRows)
      : undefined;

  return {
    items: pageRows.map(toStepAttemptSummary),
    nextCursor: hasMore && last ? {attempt: last.attempt, id: last.id} : null,
    total,
    stepType: step.type,
  };
}

interface JobDetailTarget {
  workflowRunId: string;
  workflowRunAttemptId: string;
  workflowRunAttempt: number;
}

interface ExecutionSummaryRow {
  id: string;
  sequence: number;
  name: string | null;
  jobName: string | null;
  jobKey: string;
  status: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  statusReasonMessage: string | null;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
  updatedAt: Date;
  hasRunningStep: boolean;
}

interface ExecutionProjection extends ExecutionSummaryRow {
  jobId: string;
  hasContext: boolean;
}

interface StepRow {
  id: string;
  key: string | null;
  name: string;
  type: StepType;
  position: number;
  status: StepStatus;
  statusReason: StepStatusReason | null;
  sourceLocation: StepSourceLocation | null;
  currentAttempt: number;
  error: Record<string, unknown> | null;
}

type StepAttemptSummaryRow = Omit<WorkflowStepAttemptSummaryRead, 'status'> & {
  status: string;
};

interface StepAttemptPreviewRow extends WorkflowStepAttemptSummaryRead {
  stepId: string;
  rowNumber: number;
  totalCount: number;
}

async function loadJobDetailTarget(tx: Tx, jobId: string): Promise<JobDetailTarget | undefined> {
  const [row] = await tx
    .select({
      workflowRunId: workflowRuns.id,
      workflowRunAttemptId: workflowRunAttempts.id,
      workflowRunAttempt: workflowRunAttempts.attempt,
    })
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row;
}

async function loadExecutionProjection(
  tx: Tx,
  jobId: string,
  executionId: string,
): Promise<ExecutionProjection | undefined> {
  const [row] = await tx
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
      hasContext: hasExecutionContext(),
    })
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(and(eq(jobExecutions.jobId, jobId), eq(jobExecutions.id, executionId)))
    .limit(1);
  if (!row) return undefined;
  return {
    ...row,
    jobId: row.jobId,
    hasContext: row.hasContext,
  };
}

async function loadExecutionPageRows(
  tx: Tx,
  params: {
    jobId: string;
    limit: number;
    cursor?: WorkflowJobExecutionCursor | undefined;
  },
  recordRows: (count: number) => void,
): Promise<ExecutionSummaryRow[]> {
  const conditions = [eq(jobExecutions.jobId, params.jobId)];
  if (params.cursor) {
    const cursorCondition = or(
      lt(jobExecutions.sequence, params.cursor.sequence),
      and(
        eq(jobExecutions.sequence, params.cursor.sequence),
        lt(jobExecutions.id, params.cursor.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await tx
    .select({
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
    .where(and(...conditions))
    .orderBy(desc(jobExecutions.sequence), desc(jobExecutions.id))
    .limit(params.limit + 1);
  recordRows(rows.length);
  return rows;
}

function toJobDetailRead(
  target: JobDetailTarget,
  job: WorkflowRunJobOverview,
  selectedExecution: WorkflowJobExecutionDetailRead | null,
): WorkflowJobDetailRead {
  return {
    workflowRunId: target.workflowRunId,
    workflowRunAttempt: target.workflowRunAttempt,
    job,
    selectedExecution,
  };
}

async function loadStepPage(
  tx: Tx,
  jobExecutionId: string,
  params: {
    limit: number;
    cursor: WorkflowStepCursor | undefined;
    recordRows: (count: number) => void;
  },
): Promise<WorkflowStepPageRead> {
  const conditions = [eq(steps.jobExecutionId, jobExecutionId)];
  if (params.cursor) {
    const cursorCondition = or(
      gt(steps.position, params.cursor.position),
      and(eq(steps.position, params.cursor.position), gt(steps.id, params.cursor.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await tx
    .select({
      id: steps.id,
      key: steps.key,
      name: steps.name,
      type: steps.type,
      position: steps.position,
      status: steps.status,
      statusReason: steps.statusReason,
      sourceLocation: steps.sourceLocation,
      currentAttempt: steps.currentAttempt,
      error: steps.error,
    })
    .from(steps)
    .where(and(...conditions))
    .orderBy(asc(steps.position), asc(steps.id))
    .limit(params.limit + 1);
  params.recordRows(rows.length);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);
  const total =
    params.cursor === undefined
      ? await countSteps(tx, jobExecutionId, params.recordRows)
      : undefined;
  const attemptsByStepId = await loadStepAttemptPreviews(
    tx,
    pageRows.map((row) => row.id),
    params.recordRows,
  );

  return {
    items: pageRows.map((row) =>
      toStepSummary(row, attemptsByStepId.get(row.id) ?? emptyAttemptPage()),
    ),
    nextCursor: hasMore && last ? {position: last.position, id: last.id} : null,
    total,
  };
}

async function loadStepAttemptPageRows(
  tx: Tx,
  params: {
    stepId: string;
    limit: number;
    cursor?: WorkflowStepAttemptCursor | undefined;
  },
  recordRows: (count: number) => void,
): Promise<StepAttemptSummaryRow[]> {
  const conditions = [eq(stepAttempts.stepId, params.stepId)];
  if (params.cursor) {
    const cursorCondition = or(
      lt(stepAttempts.attempt, params.cursor.attempt),
      and(eq(stepAttempts.attempt, params.cursor.attempt), lt(stepAttempts.id, params.cursor.id)),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await tx
    .select({
      id: stepAttempts.id,
      attempt: stepAttempts.attempt,
      executionOrder: stepAttempts.executionOrder,
      status: stepAttempts.status,
      exitCode: stepAttempts.exitCode,
      startedAt: stepAttempts.startedAt,
      finishedAt: stepAttempts.finishedAt,
      error: stepAttempts.error,
      gateResult: stepAttempts.gateResult,
    })
    .from(stepAttempts)
    .where(and(...conditions))
    .orderBy(desc(stepAttempts.attempt), desc(stepAttempts.id))
    .limit(params.limit + 1);
  recordRows(rows.length);
  return rows;
}

async function loadStepAttemptPreviews(
  tx: Tx,
  stepIds: string[],
  recordRows: (count: number) => void,
): Promise<Map<string, WorkflowStepSummaryRead['attempts']>> {
  const pages = new Map<string, WorkflowStepSummaryRead['attempts']>();
  if (stepIds.length === 0) return pages;

  const rankedAttempts = tx
    .select({
      id: stepAttempts.id,
      stepId: stepAttempts.stepId,
      attempt: stepAttempts.attempt,
      executionOrder: stepAttempts.executionOrder,
      status: stepAttempts.status,
      exitCode: stepAttempts.exitCode,
      startedAt: stepAttempts.startedAt,
      finishedAt: stepAttempts.finishedAt,
      error: stepAttempts.error,
      gateResult: stepAttempts.gateResult,
      rowNumber: sql<number>`row_number() over (
        partition by ${stepAttempts.stepId}
        order by ${stepAttempts.attempt} desc, ${stepAttempts.id} desc
      )`.as('row_number'),
      totalCount: sql<number>`count(*) over (partition by ${stepAttempts.stepId})`.as(
        'total_count',
      ),
    })
    .from(stepAttempts)
    .where(inArray(stepAttempts.stepId, stepIds))
    .as('ranked_step_attempts');

  const rows = await tx
    .select()
    .from(rankedAttempts)
    .where(lte(rankedAttempts.rowNumber, WORKFLOW_STEP_ATTEMPT_PREVIEW_LIMIT + 1))
    .orderBy(asc(rankedAttempts.stepId), asc(rankedAttempts.rowNumber));
  recordRows(rows.length);

  const rowsByStepId = new Map<string, StepAttemptPreviewRow[]>();
  for (const row of rows) {
    const stepRows = rowsByStepId.get(row.stepId) ?? [];
    stepRows.push({
      id: row.id,
      stepId: row.stepId,
      attempt: row.attempt,
      executionOrder: row.executionOrder,
      status: row.status as StepAttemptStatus,
      exitCode: row.exitCode,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      error: (row.error as Record<string, unknown> | null) ?? null,
      gateResult: (row.gateResult as Record<string, unknown> | null) ?? null,
      rowNumber: Number(row.rowNumber),
      totalCount: Number(row.totalCount),
    });
    rowsByStepId.set(row.stepId, stepRows);
  }

  for (const stepId of stepIds) {
    const stepRows = rowsByStepId.get(stepId) ?? [];
    const pageRows = stepRows.filter((row) => row.rowNumber <= WORKFLOW_STEP_ATTEMPT_PREVIEW_LIMIT);
    const hasMore = stepRows.length > WORKFLOW_STEP_ATTEMPT_PREVIEW_LIMIT;
    const last = pageRows.at(-1);
    pages.set(stepId, {
      items: pageRows.map(toStepAttemptSummary),
      nextCursor: hasMore && last ? {attempt: last.attempt, id: last.id} : null,
      total: stepRows[0]?.totalCount ?? 0,
    });
  }
  return pages;
}

function toStepSummary(
  row: StepRow,
  attempts: WorkflowStepSummaryRead['attempts'],
): WorkflowStepSummaryRead {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    type: row.type,
    position: row.position,
    status: row.status,
    statusReason: toStepStatusReason(row.statusReason),
    sourceLocation: row.sourceLocation,
    currentAttempt: row.currentAttempt,
    error: (row.error as Record<string, unknown> | null) ?? null,
    attempts,
  };
}

function toStepAttemptSummary(row: StepAttemptSummaryRow): WorkflowStepAttemptSummaryRead {
  return {
    id: row.id,
    attempt: row.attempt,
    executionOrder: row.executionOrder,
    status: row.status as StepAttemptStatus,
    exitCode: row.exitCode,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
    gateResult: row.gateResult,
  };
}

function toExecutionSummary(
  row: Pick<
    ExecutionSummaryRow,
    | 'id'
    | 'sequence'
    | 'name'
    | 'jobName'
    | 'jobKey'
    | 'status'
    | 'statusReason'
    | 'statusReasonMessage'
    | 'queuedAt'
    | 'startedAt'
    | 'finishedAt'
    | 'timedOutAt'
    | 'updatedAt'
    | 'hasRunningStep'
  >,
): WorkflowRunJobExecutionSummary {
  return {
    id: row.id,
    sequence: row.sequence,
    name: row.name ?? row.jobName ?? row.jobKey,
    status: row.status,
    displayStatus: row.status === 'running' && row.hasRunningStep !== true ? 'pending' : row.status,
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

function runningStepExists(executionId: typeof jobExecutions.id) {
  return sql<boolean>`exists (
    select 1
    from ${steps}
    where ${steps.jobExecutionId} = ${executionId}
      and ${steps.status} = 'running'
  )`;
}

function hasExecutionContext() {
  return sql<boolean>`(
    ${jobExecutions.runner} is not null
    or ${jobExecutions.outputs} is not null
    or ${jobExecutions.evaluationTrace} is not null
    or coalesce(jsonb_array_length(${jobExecutions.triggerEvents}), 0) > 0
  )`;
}

async function countJobExecutions(
  tx: Tx,
  jobId: string,
  recordRows: (count: number) => void,
): Promise<number> {
  const [row] = await tx
    .select({total: count()})
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId));
  recordRows(row ? 1 : 0);
  return Number(row?.total ?? 0);
}

async function countSteps(
  tx: Tx,
  jobExecutionId: string,
  recordRows: (count: number) => void,
): Promise<number> {
  const [row] = await tx
    .select({total: count()})
    .from(steps)
    .where(eq(steps.jobExecutionId, jobExecutionId));
  recordRows(row ? 1 : 0);
  return Number(row?.total ?? 0);
}

async function countStepAttemptsForRead(
  tx: Tx,
  stepId: string,
  recordRows: (count: number) => void,
): Promise<number> {
  const [row] = await tx
    .select({total: count()})
    .from(stepAttempts)
    .where(eq(stepAttempts.stepId, stepId));
  recordRows(row ? 1 : 0);
  return Number(row?.total ?? 0);
}

function emptyAttemptPage(): WorkflowStepSummaryRead['attempts'] {
  return {items: [], nextCursor: null, total: 0};
}

function boundedExecutionCount(value: number): BoundedExecutionCount {
  return value > WORKFLOW_RUN_EXECUTION_COUNT_LIMIT ? '100+' : value;
}

async function withReadMeasurement<TResult>(
  options: WorkflowJobReadOptions,
  operation: (recordRows: (count: number) => void) => Promise<TResult>,
): Promise<TResult> {
  const startedAt = performance.now();
  let returnedRows = 0;
  try {
    return await operation((count) => {
      returnedRows += count;
    });
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
