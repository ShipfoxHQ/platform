import {WORKFLOWS_JOB_EXECUTION_TIMED_OUT} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {
  MAX_JOB_OUTPUT_ENTRIES,
  MAX_JOB_OUTPUT_VALUE_BYTES,
} from '#core/step-config/job-output-limits.js';
import {buildModel, template, workflowRunAttemptId} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {workflowsOutbox} from '../schema/outbox.js';
import {
  applyStepResult,
  createWorkflowRun,
  failJobExecutionAsTimedOut,
  finishStepAttempt,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  markStepRunning,
  resolveJobExecutionAfterLeaseExpiry,
  updateJobExecutionStatus,
} from '../workflow-runs.js';

describe('workflow run job executions', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  test('derives timeout outbox attempt identity from the job execution', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    const actualAttemptId = await workflowRunAttemptId(run.id);

    await failJobExecutionAsTimedOut({
      jobExecutionId: execution.id,
      workflowRunAttemptId: crypto.randomUUID(),
      expectedVersion: execution.version,
    });

    const [event] = await db()
      .select({payload: workflowsOutbox.payload})
      .from(workflowsOutbox)
      .where(
        and(
          eq(workflowsOutbox.eventType, WORKFLOWS_JOB_EXECUTION_TIMED_OUT),
          sql`${workflowsOutbox.payload}->>'jobExecutionId' = ${execution.id}`,
        ),
      );
    expect(event?.payload).toMatchObject({
      jobId: job.id,
      jobExecutionId: execution.id,
      workflowRunAttemptId: actualAttemptId,
    });
  });

  test('does not cancel steps when lease expiry loses the execution version race', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'running',
      expectedVersion: execution.version,
    });

    await resolveJobExecutionAfterLeaseExpiry({
      jobExecutionId: execution.id,
      expectedVersion: execution.version,
    });

    const jobSteps = await getStepsByJobId(job.id);
    expect(jobSteps.every((step) => step.status === 'pending')).toBe(true);
  });

  test('persists a structured job output when execution succeeds', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: {findings: template('steps.collect.outputs.findings')},
            outputTypes: {
              findings: {
                kind: 'list',
                element: {kind: 'object', fields: {severity: 'string'}},
              },
            },
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    await finishCollectedStep(job.id, {findings: [{severity: 'high'}]});

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved.outputs).toEqual({findings: [{severity: 'high'}]});
    expect(Array.isArray(resolved.outputs?.findings)).toBe(true);
    const persisted = await getFirstJobExecutionByJobId(job.id);
    expect(persisted?.outputs).toEqual({findings: [{severity: 'high'}]});
  });

  test('persists JSON-safe typed integer and timestamp outputs when execution succeeds', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: {
              count: template('steps.collect.outputs.count'),
              createdAt: template('run.created_at'),
            },
            outputTypes: {count: 'int', createdAt: 'timestamp'},
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    await finishCollectedStep(job.id, {count: 42});

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved.outputs).toEqual({count: 42, createdAt: run.createdAt.toISOString()});
    const persisted = await getFirstJobExecutionByJobId(job.id);
    expect(persisted?.outputs).toEqual({count: 42, createdAt: run.createdAt.toISOString()});
  });

  test('fails a successful execution when a materialized job output is too large', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: {payload: template('steps.collect.outputs.payload')},
            outputTypes: {payload: {kind: 'list', element: 'string'}},
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    const payload = ['x'.repeat(MAX_JOB_OUTPUT_VALUE_BYTES - 1)];
    const measuredBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    await finishCollectedStep(job.id, {payload});

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved).toMatchObject({
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage:
        `Job output "payload" exceeds the per-value size limit of ${MAX_JOB_OUTPUT_VALUE_BYTES} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${measuredBytes - MAX_JOB_OUTPUT_VALUE_BYTES} bytes).`,
      outputs: null,
    });
  });

  test('fails a successful execution when the persisted model has too many job outputs', async () => {
    const outputs = Object.fromEntries(
      Array.from({length: MAX_JOB_OUTPUT_ENTRIES + 1}, (_, index) => {
        const key = `output${index}`;
        return [key, template(`steps.collect.outputs.${key}`)];
      }),
    );
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs,
          },
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    const execution = await getFirstJobExecutionByJobId(job.id);
    if (!execution) throw new Error('Expected job execution');
    await finishCollectedStep(job.id, {});

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved).toMatchObject({status: 'failed', statusReason: 'unknown', outputs: null});
  });
});

async function finishCollectedStep(jobId: string, output: Record<string, unknown>): Promise<void> {
  const steps = await getStepsByJobId(jobId);
  const step = steps.find((candidate) => candidate.key === 'collect');
  if (!step) throw new Error('Expected collect step');

  await db().transaction(async (tx) => {
    const running = await markStepRunning(
      {jobExecutionId: step.jobExecutionId, stepId: step.id},
      tx,
    );
    if (!running) throw new Error('Expected pending collect step');
    await finishStepAttempt(
      {
        stepId: step.id,
        attempt: running.currentAttempt,
        status: 'succeeded',
        output,
        response: null,
        exitCode: 0,
        logOutcome: 'drained',
      },
      tx,
    );
    await applyStepResult(
      {
        jobExecutionId: step.jobExecutionId,
        stepId: step.id,
        status: 'succeeded',
        error: null,
      },
      tx,
    );
  });
}
