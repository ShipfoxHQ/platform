import {WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED} from '@shipfox/api-workflows-dto';
import type {SQL} from 'drizzle-orm';
import {
  assertWorkflowExecutionPayloadSize,
  assertWorkflowProductOutputSize,
  boundWorkflowStepError,
  observeWorkflowDiagnosticSize,
} from '#core/diagnostics.js';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import type {Tx} from '../db.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {
  type JobExecutionCreateDb,
  type JobExecutionDb,
  jobExecutions,
} from '../schema/job-executions.js';
import {type JobCreateDb, type JobDb, jobs} from '../schema/jobs.js';
import {type StepCreateDb, steps} from '../schema/steps.js';
import {writeJobExecutionTerminatedOutbox} from './outbox.js';

type MaterializedRunGraphJobExecution = Omit<JobExecutionCreateDb, 'finishedAt' | 'jobId'> & {
  readonly finishedAt?: JobExecutionCreateDb['finishedAt'] | SQL | undefined;
};

export interface MaterializedRunGraphJob {
  readonly job: Omit<JobCreateDb, 'workflowRunAttemptId'>;
  readonly createExecution?:
    | ((job: JobDb) => MaterializedRunGraphJobExecution | undefined)
    | undefined;
  readonly createSteps?:
    | ((params: {
        readonly job: JobDb;
        readonly jobExecution: JobExecutionDb;
      }) => readonly Omit<StepCreateDb, 'jobExecutionId'>[])
    | undefined;
}

export async function persistMaterializedRunGraph(
  tx: Tx,
  params: {
    readonly run: Pick<WorkflowRun, 'id' | 'workspaceId' | 'projectId' | 'definitionId'>;
    readonly workflowRunAttempt: {readonly id: string; readonly attempt: number};
    readonly materializedJobs: readonly MaterializedRunGraphJob[];
    readonly carryOverFromWorkflowRunAttemptId?: string | undefined;
  },
): Promise<void> {
  for (const materializedJob of params.materializedJobs) {
    assertWorkflowExecutionPayloadSize('condition', materializedJob.job.success);
    assertWorkflowProductOutputSize('job_outputs', materializedJob.job.outputs);
    observeWorkflowDiagnosticSize('job_evaluation_trace', materializedJob.job.evaluationTrace);
  }

  const jobRows =
    params.materializedJobs.length === 0
      ? []
      : await tx
          .insert(jobs)
          .values(
            params.materializedJobs.map((materializedJob) => ({
              ...materializedJob.job,
              workflowRunAttemptId: params.workflowRunAttempt.id,
            })),
          )
          .returning();

  const jobExecutionValues = jobRows.flatMap((jobRow, jobIndex) => {
    const materializedJob = params.materializedJobs[jobIndex];
    const jobExecution = materializedJob?.createExecution?.(jobRow);
    return jobExecution === undefined ? [] : [{...jobExecution, jobId: jobRow.id}];
  });
  for (const jobExecution of jobExecutionValues) {
    assertWorkflowProductOutputSize('execution_outputs', jobExecution.outputs);
    observeWorkflowDiagnosticSize('execution_evaluation_trace', jobExecution.evaluationTrace);
  }
  const jobExecutionRows =
    jobExecutionValues.length === 0
      ? []
      : await tx.insert(jobExecutions).values(jobExecutionValues).returning();

  for (const jobExecution of jobExecutionRows) {
    if (
      jobExecution.status === 'succeeded' ||
      jobExecution.status === 'failed' ||
      jobExecution.status === 'cancelled'
    ) {
      await writeJobExecutionTerminatedOutbox(tx, {
        jobId: jobExecution.jobId,
        jobExecutionId: jobExecution.id,
        status: jobExecution.status,
        finishedAt: jobExecution.finishedAt,
        statusReason: jobExecution.statusReason,
        statusReasonMessage: jobExecution.statusReasonMessage,
        queuedAt: jobExecution.queuedAt,
        startedAt: jobExecution.startedAt,
        runnerLabels: jobExecution.runnerLabels,
        templateKey: jobExecution.templateKey,
        provisionerId: jobExecution.provisionerId,
        provisionerScope: jobExecution.provisionerScope,
        providerKind: jobExecution.providerKind,
        launchKind: jobExecution.launchKind,
      });
    }
  }

  const jobById = new Map(jobRows.map((job) => [job.id, job]));
  const materializedJobByJobId = new Map(
    jobRows.flatMap((jobRow, index) => {
      const materializedJob = params.materializedJobs[index];
      return materializedJob === undefined ? [] : [[jobRow.id, materializedJob] as const];
    }),
  );
  const stepValues = jobExecutionRows.flatMap((jobExecution) => {
    const job = jobById.get(jobExecution.jobId);
    const materializedJob = materializedJobByJobId.get(jobExecution.jobId);
    if (!job || !materializedJob) return [];

    return (materializedJob.createSteps?.({job, jobExecution}) ?? []).map((step) => ({
      ...step,
      jobExecutionId: jobExecution.id,
    }));
  });

  for (const step of stepValues) {
    assertWorkflowExecutionPayloadSize('resolved_config', step.config);
    assertWorkflowExecutionPayloadSize('config_plan', step.configPlan);
    assertWorkflowExecutionPayloadSize('condition', step.condition);
    observeWorkflowDiagnosticSize('evaluation_trace', step.evaluationTrace);
    assertWorkflowExecutionPayloadSize('authored_config', step.authoredConfig);
    step.error = boundWorkflowStepError(step.error);
  }

  if (stepValues.length > 0) {
    await tx.insert(steps).values(stepValues);
  }

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
    payload: {
      workflowRunId: params.run.id,
      workflowRunAttemptId: params.workflowRunAttempt.id,
      attempt: params.workflowRunAttempt.attempt,
      workspaceId: params.run.workspaceId,
      projectId: params.run.projectId,
      definitionId: params.run.definitionId,
      ...(params.carryOverFromWorkflowRunAttemptId === undefined
        ? {}
        : {carryOverFromWorkflowRunAttemptId: params.carryOverFromWorkflowRunAttemptId}),
    },
  });
}
