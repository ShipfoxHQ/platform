import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
} from '@shipfox/api-workflows-dto';
import {createWorkflowExpression} from '@shipfox/expression';
import {and, eq, sql} from 'drizzle-orm';
import {JobNotFoundError} from '#core/errors.js';
import {db} from '#db/db.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {workflowRunAttempts} from '#db/schema/workflow-run-attempts.js';
import {
  bulkUpdateStepStatuses,
  createWorkflowRun,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';

export type TestWorkflowModelInput = Parameters<typeof workflowModel>[0];

export function buildModel(overrides?: TestWorkflowModelInput) {
  return workflowModel(overrides);
}

export function template(source: string): string {
  return `\${{ ${source} }}`;
}

export function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

export function conditionTrace(
  field: 'job.if',
  expression: string,
  roots: string[],
  value: boolean,
  degraded = false,
) {
  return {
    expression,
    roots,
    fillTarget: 'job-activation',
    evaluatedAt: 'job-activation',
    value: String(value),
    ...(degraded ? {degraded: true} : {}),
    field,
  };
}

export function stepOutputField(stepKey: string, outputKey: string) {
  return {
    segments: [
      {
        kind: 'deferred' as const,
        expression: createWorkflowExpression({
          source: `steps.${stepKey}.outputs.${outputKey}`,
          check: {mode: 'syntax'},
        }),
        roots: ['steps'],
        fillTarget: 'step-dispatch' as const,
      },
    ],
  };
}

export function shellRef(name: string): string {
  return `\${${name}}`;
}

export async function bulkUpdateJobStepStatuses(
  params: Omit<Parameters<typeof bulkUpdateStepStatuses>[0], 'jobExecutionId'> & {jobId: string},
) {
  const jobExecution = await getFirstJobExecutionByJobId(params.jobId);
  if (!jobExecution) throw new JobNotFoundError(params.jobId);
  await bulkUpdateStepStatuses({jobExecutionId: jobExecution.id, status: params.status});
}

export function createTestRun(scope: {
  workspaceId: string;
  projectId: string;
  definitionId: string;
}) {
  return createWorkflowRun({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    definitionId: scope.definitionId,
    model: buildModel(),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
}

export async function workflowRunAttemptId(workflowRunId: string): Promise<string> {
  const [attempt] = await db()
    .select()
    .from(workflowRunAttempts)
    .where(eq(workflowRunAttempts.workflowRunId, workflowRunId))
    .limit(1);
  if (!attempt) throw new Error(`Run attempt not found for run ${workflowRunId}`);
  return attempt.id;
}

export async function jobByKey(workflowRunId: string, key: string) {
  const runJobs = await getJobsByWorkflowRunId(workflowRunId);
  const job = runJobs.find((item) => item.key === key);
  if (!job) throw new Error(`Job not found: ${key}`);
  return job;
}

export async function jobTerminatedEvents(jobId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_JOB_TERMINATED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        jobId: string;
        workflowRunId: string;
        status: string;
        statusReason: string | null;
        statusReasonMessage?: string | null;
      },
  );
}

export async function runTerminatedEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_TERMINATED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        workflowRunId: string;
        workflowRunAttemptId: string;
        projectId: string;
        status: string;
      },
  );
}

export async function runCancelledEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_CANCELLED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {workflowRunId: string; workflowRunAttemptId: string; projectId: string},
  );
}

export async function runAttemptCreatedEvents(workflowRunId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED),
        sql`${workflowsOutbox.payload}->>'workflowRunId' = ${workflowRunId}`,
      ),
    );
  return rows.map(
    (row) =>
      row.payload as {
        workflowRunId: string;
        workflowRunAttemptId: string;
        attempt: number;
        workspaceId: string;
        projectId: string;
        definitionId: string;
      },
  );
}

export async function stepAttemptTerminatedEvents(jobId: string) {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_STEP_ATTEMPT_TERMINATED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload);
}
