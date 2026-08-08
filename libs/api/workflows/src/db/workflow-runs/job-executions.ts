import {readPersistedWorkflowModel} from '@shipfox/api-definitions-dto';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {WORKFLOWS_JOB_EXECUTION_TIMED_OUT} from '@shipfox/api-workflows-dto';
import {and, asc, desc, eq, isNull, notInArray, sql} from 'drizzle-orm';
import type {JobStatusReason} from '#core/entities/job.js';
import type {JobExecution, JobExecutionStatus} from '#core/entities/job-execution.js';
import {
  InterpolationUnresolvableError,
  JobNotFoundError,
  JobOutputNotJsonSafeError,
  JobOutputTooLargeError,
  JobOutputTooManyEntriesError,
} from '#core/errors.js';
import {deriveJobExecutionOutputs} from '#core/job-transition/index.js';
import {deriveCompletion, isTerminal} from '#core/step-transition/decide-step-transition.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';
import {
  recordWorkflowJobExecutionLeaseExpiryResolved,
  recordWorkflowJobExecutionQueued,
  recordWorkflowJobExecutionStarted,
  recordWorkflowJobExecutionStatusChanged,
  recordWorkflowJobExecutionTimedOut,
} from '#metrics/instance.js';
import {db, type Tx} from '../db.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {jobExecutions, toJobExecution} from '../schema/job-executions.js';
import {jobs, toJob} from '../schema/jobs.js';
import {stepAttempts, toStepAttempt} from '../schema/step-attempts.js';
import {steps, toStep} from '../schema/steps.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from '../schema/workflow-runs.js';
import {getDirectDependencyJobContexts} from './jobs.js';
import {loadReferencedVariables} from './runs.js';
import {
  getWorkflowContextForJob,
  optimisticLockRetry,
  TERMINAL_EXECUTION_STATUSES,
} from './shared.js';
import {bulkUpdateStepStatuses, getStepsByJobExecutionIdForUpdate} from './steps.js';

async function getJobExecutionFallbackName(tx: Tx, jobExecutionId: string): Promise<string> {
  const [row] = await tx
    .select({job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobExecutions.id, jobExecutionId))
    .limit(1);
  if (!row) throw new JobNotFoundError(jobExecutionId);
  return row.job.name ?? row.job.key;
}

export async function getJobExecutionById(id: string, tx?: Tx): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select({jobExecution: jobExecutions, job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobExecutions.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row.jobExecution, row.job.name ?? row.job.key) : undefined;
}

export async function getJobExecutionsByWorkflowRunAttemptId(
  workflowRunAttemptId: string,
): Promise<JobExecution[]> {
  const rows = await db()
    .select({jobExecution: jobExecutions, job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobs.workflowRunAttemptId, workflowRunAttemptId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map((row) => toJobExecution(row.jobExecution, row.job.name ?? row.job.key));
}

export async function getJobExecutionsByJobId(jobId: string): Promise<JobExecution[]> {
  const rows = await db()
    .select({jobExecution: jobExecutions, job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return rows.map((row) => toJobExecution(row.jobExecution, row.job.name ?? row.job.key));
}

export async function getFirstJobExecutionByJobId(
  jobId: string,
  tx?: Tx,
): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select({jobExecution: jobExecutions, job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row.jobExecution, row.job.name ?? row.job.key) : undefined;
}

export async function getLatestJobExecutionByJobId(
  jobId: string,
  tx?: Tx,
): Promise<JobExecution | undefined> {
  const rows = await (tx ?? db())
    .select({jobExecution: jobExecutions, job: jobs})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(desc(jobExecutions.sequence), desc(jobExecutions.id))
    .limit(1);
  const row = rows[0];
  return row ? toJobExecution(row.jobExecution, row.job.name ?? row.job.key) : undefined;
}

export interface UpdateJobExecutionStatusAtVersionParams {
  jobExecutionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  statusReasonMessage?: string | null | undefined;
  markTimedOut?: boolean;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}

async function resolveJobExecutionOutputs(
  tx: Tx,
  params: {
    jobExecutionId: string;
    status: JobExecutionStatus;
    statusReason: JobStatusReason | null;
    secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
  },
): Promise<Record<string, unknown> | null> {
  const [target] = await tx
    .select({execution: jobExecutions, job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobExecutions)
    .innerJoin(jobs, eq(jobExecutions.jobId, jobs.id))
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobExecutions.id, params.jobExecutionId))
    .limit(1);
  if (!target) throw new JobNotFoundError(params.jobExecutionId);
  const model =
    target.attempt.model === null ? null : readPersistedWorkflowModel(target.attempt.model);
  if (!model) return null;
  const modelJob = model.jobs.find((job) => job.key === target.job.key);
  if (!modelJob || modelJob.outputs === undefined) return null;

  const executionRows = await tx
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, target.job.id))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  const fallbackName = target.job.name ?? target.job.key;
  const executions = executionRows.map((row) =>
    row.id === target.execution.id
      ? toJobExecution(
          {...row, status: params.status, statusReason: params.statusReason},
          fallbackName,
        )
      : toJobExecution(row, fallbackName),
  );
  const jobExecution = executions.find((execution) => execution.id === target.execution.id);
  if (!jobExecution) throw new JobNotFoundError(params.jobExecutionId);

  const stepRows = await tx
    .select()
    .from(steps)
    .where(eq(steps.jobExecutionId, params.jobExecutionId))
    .orderBy(asc(steps.position), asc(steps.id));
  const attemptRows = await tx
    .select()
    .from(stepAttempts)
    .where(eq(stepAttempts.jobExecutionId, params.jobExecutionId))
    .orderBy(asc(stepAttempts.executionOrder), asc(stepAttempts.id));
  const dependencyJobs = await getDirectDependencyJobContexts(target.job.id, tx);

  return deriveJobExecutionOutputs({
    run: toWorkflowRun(target.run),
    modelJob,
    job: toJob(target.job),
    jobExecution,
    executions,
    steps: stepRows.map(toStep),
    attempts: attemptRows.map(toStepAttempt),
    jobs: dependencyJobs,
    vars: await loadReferencedVariables({
      model,
      jobs: [modelJob],
      workspaceId: target.run.workspaceId,
      projectId: target.run.projectId,
      definitionId: target.run.definitionId,
      secrets: params.secrets,
    }),
  });
}

async function updateJobExecutionStatusAtVersion(
  tx: Tx,
  params: UpdateJobExecutionStatusAtVersionParams,
): Promise<{execution: JobExecution; changed: boolean} | null> {
  let status = params.status;
  let statusReason = params.statusReason ?? null;
  let statusReasonMessage = params.statusReasonMessage ?? null;
  let outputs: Record<string, unknown> | null | undefined;
  if (TERMINAL_EXECUTION_STATUSES.includes(status)) {
    outputs = null;
  }
  if (status === 'succeeded') {
    try {
      outputs = await resolveJobExecutionOutputs(tx, {
        jobExecutionId: params.jobExecutionId,
        status,
        statusReason,
        secrets: params.secrets,
      });
    } catch (error) {
      if (
        !(error instanceof InterpolationUnresolvableError) &&
        !(error instanceof JobOutputNotJsonSafeError) &&
        !(error instanceof JobOutputTooLargeError) &&
        !(error instanceof JobOutputTooManyEntriesError)
      ) {
        throw error;
      }
      status = 'failed';
      statusReason = error instanceof JobOutputTooLargeError ? 'output_too_large' : 'unknown';
      statusReasonMessage = error instanceof JobOutputTooLargeError ? error.message : null;
      outputs = null;
    }
  }

  const rows = await tx
    .update(jobExecutions)
    .set({
      status,
      statusReason,
      statusReasonMessage,
      ...(outputs === undefined ? {} : {outputs}),
      version: sql`${jobExecutions.version} + 1`,
      updatedAt: new Date(),
      ...(params.markTimedOut ? {timedOutAt: new Date()} : {}),
      ...(TERMINAL_EXECUTION_STATUSES.includes(status) ? {finishedAt: sql`now()`} : {}),
    })
    .where(
      and(
        eq(jobExecutions.id, params.jobExecutionId),
        eq(jobExecutions.version, params.expectedVersion),
        notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return null;
  return {
    execution: toJobExecution(row, await getJobExecutionFallbackName(tx, row.id)),
    changed: true,
  };
}

export interface UpdateJobExecutionStatusParams {
  jobExecutionId: string;
  status: JobExecutionStatus;
  expectedVersion: number;
  statusReason?: JobStatusReason | null | undefined;
  statusReasonMessage?: string | null | undefined;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}

export async function updateJobExecutionStatus(
  params: UpdateJobExecutionStatusParams,
): Promise<JobExecution> {
  const statusReason = params.statusReason ?? null;
  const result = await db().transaction(async (tx) => {
    return await optimisticLockRetry({
      updateFn: () =>
        updateJobExecutionStatusAtVersion(tx, {
          jobExecutionId: params.jobExecutionId,
          status: params.status,
          expectedVersion: params.expectedVersion,
          statusReason,
          statusReasonMessage: params.statusReasonMessage,
          secrets: params.secrets,
        }),
      fetchFn: async () => {
        const row = (
          await tx
            .select()
            .from(jobExecutions)
            .where(eq(jobExecutions.id, params.jobExecutionId))
            .limit(1)
        )[0];
        return row ? toJobExecution(row, await getJobExecutionFallbackName(tx, row.id)) : undefined;
      },
      matchFn: (execution) =>
        (execution.status === params.status && execution.statusReason === statusReason) ||
        TERMINAL_EXECUTION_STATUSES.includes(execution.status)
          ? {execution, changed: false}
          : null,
      failureMessage: `Optimistic lock failure: job execution ${params.jobExecutionId} version ${params.expectedVersion}`,
    });
  });

  if (result.changed) recordWorkflowJobExecutionStatusChanged(result.execution.status);

  return result.execution;
}

export async function recordJobExecutionQueuedAt(params: {
  jobExecutionId: string;
  queuedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({queuedAt: params.queuedAt})
    .where(and(eq(jobExecutions.id, params.jobExecutionId), isNull(jobExecutions.queuedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobExecutionQueued();
}

export async function recordJobExecutionStartedAt(params: {
  jobExecutionId: string;
  startedAt: Date;
}): Promise<void> {
  const updated = await db()
    .update(jobExecutions)
    .set({startedAt: params.startedAt})
    .where(and(eq(jobExecutions.id, params.jobExecutionId), isNull(jobExecutions.startedAt)))
    .returning({id: jobExecutions.id});

  if (updated.length > 0) recordWorkflowJobExecutionStarted();
}

export async function failJobExecutionAsTimedOut(params: {
  jobExecutionId: string;
  workflowRunAttemptId: string;
  expectedVersion: number;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}): Promise<JobExecution> {
  const result = await db().transaction(async (tx) => {
    const updated = await optimisticLockRetry({
      updateFn: () =>
        updateJobExecutionStatusAtVersion(tx, {
          jobExecutionId: params.jobExecutionId,
          status: 'failed',
          expectedVersion: params.expectedVersion,
          statusReason: 'timed_out',
          markTimedOut: true,
          secrets: params.secrets,
        }),
      fetchFn: async () => {
        const row = (
          await tx
            .select()
            .from(jobExecutions)
            .where(eq(jobExecutions.id, params.jobExecutionId))
            .limit(1)
        )[0];
        return row ? toJobExecution(row, await getJobExecutionFallbackName(tx, row.id)) : undefined;
      },
      matchFn: (execution) => (execution.timedOutAt !== null ? {execution, changed: false} : null),
      failureMessage: `Optimistic lock failure: job execution ${params.jobExecutionId} version ${params.expectedVersion}`,
    });

    if (updated.changed) {
      const identity = await getWorkflowContextForJob(updated.execution.jobId, tx);
      await writeWorkflowsOutboxEvent(tx, {
        type: WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
        payload: {
          jobId: identity.jobId,
          jobExecutionId: params.jobExecutionId,
          workflowRunAttemptId: identity.workflowRunAttemptId,
        },
      });
    }

    return updated;
  });

  if (result.changed) {
    recordWorkflowJobExecutionStatusChanged(result.execution.status);
    recordWorkflowJobExecutionTimedOut();
  }

  return result.execution;
}

export async function resolveJobExecutionAfterLeaseExpiry(params: {
  jobExecutionId: string;
  expectedVersion: number;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  const result = await db().transaction(async (tx) => {
    const jobExecutionSteps = await getStepsByJobExecutionIdForUpdate(params.jobExecutionId, tx);
    let changedJobExecution: JobExecution | null = null;

    if (jobExecutionSteps.length === 0) {
      throw new JobNotFoundError(params.jobExecutionId);
    }

    if (jobExecutionSteps.every((step) => isTerminal(step.status))) {
      const status = deriveCompletion(jobExecutionSteps);
      const updated = await updateJobExecutionStatusAtVersion(tx, {
        jobExecutionId: params.jobExecutionId,
        status,
        expectedVersion: params.expectedVersion,
        statusReason: statusReasonForStepCompletion(status),
        secrets: params.secrets,
      });
      changedJobExecution = updated?.changed ? updated.execution : null;
    } else {
      const updated = await updateJobExecutionStatusAtVersion(tx, {
        jobExecutionId: params.jobExecutionId,
        status: 'failed',
        expectedVersion: params.expectedVersion,
        statusReason: 'runner_lost',
        secrets: params.secrets,
      });
      if (updated?.changed) {
        changedJobExecution = updated.execution;
        await bulkUpdateStepStatuses(
          {jobExecutionId: params.jobExecutionId, status: 'cancelled'},
          tx,
        );
      }
    }

    const jobExecutionRow = (
      await tx
        .select()
        .from(jobExecutions)
        .where(eq(jobExecutions.id, params.jobExecutionId))
        .limit(1)
    )[0];
    if (!jobExecutionRow) {
      throw new Error(`Job execution not found resolving lease expiry: ${params.jobExecutionId}`);
    }
    const status: RuntimeCompletionStatus =
      jobExecutionRow.status === 'succeeded' ? 'succeeded' : 'failed';
    return {status, executionVersion: jobExecutionRow.version, changedJobExecution};
  });

  recordWorkflowJobExecutionLeaseExpiryResolved(result.status);
  if (result.changedJobExecution) {
    recordWorkflowJobExecutionStatusChanged(result.changedJobExecution.status);
  }

  return {status: result.status, executionVersion: result.executionVersion};
}

function statusReasonForStepCompletion(status: RuntimeCompletionStatus): JobStatusReason | null {
  return status === 'failed' ? 'step_failed' : null;
}
