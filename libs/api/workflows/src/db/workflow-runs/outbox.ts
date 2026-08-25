import {
  type LogOutcomeDto,
  WORKFLOWS_JOB_EXECUTION_QUEUED,
  WORKFLOWS_JOB_EXECUTION_TERMINATED,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import type {JobStatusReason} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {Tx} from '../db.js';
import {writeWorkflowsOutboxEvent} from '../outbox-writes.js';
import {jobExecutions} from '../schema/job-executions.js';
import {steps} from '../schema/steps.js';
import {getWorkflowContextForJob} from './shared.js';

export async function writeJobExecutionQueuedOutbox(
  tx: Tx,
  params: {
    jobId: string;
    jobExecutionId: string;
    requiredLabels: string[];
    queuedAt: Date;
  },
): Promise<void> {
  const identity = await getWorkflowContextForJob(params.jobId, tx);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_EXECUTION_QUEUED,
    payload: {
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      requiredLabels: params.requiredLabels,
      queuedAt: params.queuedAt.toISOString(),
    },
  });
}

export async function writeJobExecutionTerminatedOutbox(
  tx: Tx,
  params: {
    jobId: string;
    jobExecutionId: string;
    status: JobExecutionStatus;
    statusReason: JobStatusReason | null;
    statusReasonMessage?: string | null | undefined;
  },
): Promise<void> {
  if (
    params.status !== 'succeeded' &&
    params.status !== 'failed' &&
    params.status !== 'cancelled'
  ) {
    throw new Error(`Cannot enqueue terminal job execution event for status ${params.status}`);
  }
  const identity = await getWorkflowContextForJob(params.jobId, tx);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_EXECUTION_TERMINATED,
    payload: {
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      status: params.status,
      statusReason: params.statusReason,
      statusReasonMessage: params.statusReasonMessage ?? null,
    },
  });
}

// Enqueue the steps-settled signal in the same transaction as the final per-step
// result, so per-step execution observes it exactly once (the outbox is at-least-once;
// the job workflow dedupes the signal). Drives the Temporal JOB_FINISHED_SIGNAL; the
// job's terminal fact is emitted separately by updateJobStatusAtVersion.
export async function writeJobStepsSettledOutbox(
  tx: Tx,
  params: {jobId: string; jobExecutionId: string; status: 'succeeded' | 'failed'},
): Promise<void> {
  const identity = await getWorkflowContextForJob(params.jobId, tx);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_STEPS_SETTLED,
    payload: {
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      status: params.status,
    },
  });
}

export async function writeStepAttemptTerminatedOutbox(
  tx: Tx,
  params: {
    stepAttemptId: string;
    stepId: string;
    attempt: number;
    status: 'succeeded' | 'failed' | 'cancelled';
    logOutcome: LogOutcomeDto;
  },
): Promise<void> {
  const identity = await getStepAttemptTerminatedOutboxIdentity(tx, params.stepId);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_STEP_ATTEMPT_TERMINATED,
    payload: {
      jobId: identity.jobId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      stepId: params.stepId,
      attempt: params.attempt,
      status: params.status,
      logOutcome: params.logOutcome,
      stepAttemptId: params.stepAttemptId,
    },
  });
}

async function getStepAttemptTerminatedOutboxIdentity(
  tx: Tx,
  stepId: string,
): Promise<{
  jobId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
  workspaceId: string;
  projectId: string;
}> {
  const rows = await tx
    .select({
      jobId: jobExecutions.jobId,
    })
    .from(steps)
    .innerJoin(jobExecutions, eq(steps.jobExecutionId, jobExecutions.id))
    .where(eq(steps.id, stepId))
    .limit(1);
  const step = rows[0];
  if (!step) {
    throw new Error(`Cannot enqueue step-attempt-terminated event: step ${stepId} not found`);
  }

  return getWorkflowContextForJob(step.jobId, tx);
}

// Enqueue the durable audit record of a restart, in the same transaction as the
// rewind. Looks up the workflow run id like writeJobStepsSettledOutbox.
export async function writeStepRestartEnqueuedOutbox(
  tx: Tx,
  params: {
    jobId: string;
    failedStepId: string;
    failedStepAttempt: number;
    restartFromStepId: string;
    feedback: string;
  },
): Promise<void> {
  const identity = await getWorkflowContextForJob(params.jobId, tx);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_STEP_RESTART_ENQUEUED,
    payload: {
      jobId: params.jobId,
      workflowRunId: identity.workflowRunId,
      workflowRunAttemptId: identity.workflowRunAttemptId,
      failedStepId: params.failedStepId,
      failedStepAttempt: params.failedStepAttempt,
      restartFromStepId: params.restartFromStepId,
      feedback: params.feedback,
    },
  });
}
