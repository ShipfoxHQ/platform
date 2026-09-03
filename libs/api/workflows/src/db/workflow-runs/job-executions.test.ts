import {WORKFLOWS_JOB_EXECUTION_QUEUED} from '@shipfox/api-workflows-dto';
import {and, eq, sql} from 'drizzle-orm';
import {
  InterpolationUnresolvableError,
  JobOutputNotJsonSafeError,
  JobOutputTooLargeError,
  JobOutputTooManyEntriesError,
  WorkflowDiagnosticTooLargeError,
} from '#core/errors.js';
import {
  MAX_JOB_OUTPUT_ENTRIES,
  MAX_JOB_OUTPUT_VALUE_BYTES,
} from '#core/step-config/job-output-limits.js';
import {
  buildModel,
  jobExecutionTerminatedEvents,
  template,
  workflowRunAttemptId,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {workflowsOutbox} from '../schema/outbox.js';
import {
  applyStepResult,
  createWorkflowRun,
  finishStepAttempt,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  markStepRunning,
  queueJobExecution,
  recordJobExecutionStartedAt,
  resolveJobExecutionAfterLeaseExpiry,
  updateJobExecutionStatus,
} from '../workflow-runs.js';
import {classifyJobOutputFailure} from './job-executions.js';

describe('workflow run job executions', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  test('records and publishes the queue fact once', async () => {
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

    const queued = await queueJobExecution({jobExecutionId: execution.id});
    await queueJobExecution({jobExecutionId: execution.id});

    const events = await db()
      .select({payload: workflowsOutbox.payload})
      .from(workflowsOutbox)
      .where(
        and(
          eq(workflowsOutbox.eventType, WORKFLOWS_JOB_EXECUTION_QUEUED),
          sql`${workflowsOutbox.payload}->>'jobExecutionId' = ${execution.id}`,
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      jobId: job.id,
      jobExecutionId: execution.id,
      workflowRunId: run.id,
      workflowRunAttemptId: actualAttemptId,
      workspaceId,
      projectId,
      requiredLabels: ['ubuntu-latest'],
      queuedAt: queued.queuedAt?.toISOString(),
      jobKey: job.key,
      definitionId,
      runNumber: run.number,
    });
  });

  test('writes one terminal fact when a job execution becomes terminal', async () => {
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

    const running = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'running',
      expectedVersion: execution.version,
    });
    expect(await jobExecutionTerminatedEvents(execution.id)).toHaveLength(0);

    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'cancelled',
      expectedVersion: running.version,
      statusReason: 'run_cancelled',
    });
    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'failed',
      expectedVersion: running.version + 1,
      statusReason: 'unknown',
    });

    expect(await jobExecutionTerminatedEvents(execution.id)).toEqual([
      expect.objectContaining({
        jobId: job.id,
        jobExecutionId: execution.id,
        workflowRunId: run.id,
        status: 'cancelled',
        statusReason: 'run_cancelled',
      }),
    ]);
  });

  test('carries identity, queued, started, and runner identity in the terminated event for a claimed execution', async () => {
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

    const queued = await queueJobExecution({jobExecutionId: execution.id});
    const startedAt = new Date('2026-08-11T08:00:05.000Z');
    const provisionerId = crypto.randomUUID();
    await recordJobExecutionStartedAt({
      jobExecutionId: execution.id,
      startedAt,
      runnerIdentity: {
        runnerLabels: ['ubuntu-latest', 'x64'],
        templateKey: 'standard',
        provisionerId,
        provisionerScope: 'installation',
        providerKind: 'ec2',
        launchKind: 'demand',
      },
    });

    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'failed',
      expectedVersion: execution.version,
      statusReason: 'unknown',
    });

    expect(await jobExecutionTerminatedEvents(execution.id)).toEqual([
      expect.objectContaining({
        jobId: job.id,
        jobExecutionId: execution.id,
        workflowRunId: run.id,
        workspaceId,
        projectId,
        definitionId,
        jobKey: job.key,
        status: 'failed',
        statusReason: 'unknown',
        queuedAt: queued.queuedAt?.toISOString(),
        startedAt: startedAt.toISOString(),
        runnerLabels: ['ubuntu-latest', 'x64'],
        templateKey: 'standard',
        provisionerId,
        provisionerScope: 'installation',
        providerKind: 'ec2',
        launchKind: 'demand',
      }),
    ]);
  });

  test('carries a null started_at and null runner identity in the terminated event for a never-claimed execution', async () => {
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

    const queued = await queueJobExecution({jobExecutionId: execution.id});

    await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'cancelled',
      expectedVersion: execution.version,
      statusReason: 'run_cancelled',
    });

    expect(await jobExecutionTerminatedEvents(execution.id)).toEqual([
      expect.objectContaining({
        jobExecutionId: execution.id,
        status: 'cancelled',
        queuedAt: queued.queuedAt?.toISOString(),
        startedAt: null,
        runnerLabels: null,
        templateKey: null,
        provisionerId: null,
        provisionerScope: null,
        providerKind: null,
        launchKind: null,
      }),
    ]);
  });

  test('carries queued, started, and runner identity in the terminated event after a lease expires', async () => {
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

    const queued = await queueJobExecution({jobExecutionId: execution.id});
    const startedAt = new Date('2026-08-11T08:00:05.000Z');
    await recordJobExecutionStartedAt({
      jobExecutionId: execution.id,
      startedAt,
      runnerIdentity: {
        runnerLabels: ['ubuntu-latest'],
        templateKey: 'standard',
        provisionerId: null,
        provisionerScope: 'installation',
        providerKind: 'ec2',
        launchKind: 'demand',
      },
    });

    await resolveJobExecutionAfterLeaseExpiry({
      jobExecutionId: execution.id,
      expectedVersion: execution.version,
    });

    expect(await jobExecutionTerminatedEvents(execution.id)).toEqual([
      expect.objectContaining({
        jobExecutionId: execution.id,
        status: 'failed',
        statusReason: 'runner_lost',
        queuedAt: queued.queuedAt?.toISOString(),
        startedAt: startedAt.toISOString(),
        runnerLabels: ['ubuntu-latest'],
        templateKey: 'standard',
        provisionerScope: 'installation',
        providerKind: 'ec2',
        launchKind: 'demand',
      }),
    ]);
  });

  test('does not publish a queue fact after the execution is terminal', async () => {
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
      status: 'cancelled',
      expectedVersion: execution.version,
      statusReason: 'run_cancelled',
    });
    const after = await queueJobExecution({jobExecutionId: execution.id});

    expect(after.status).toBe('cancelled');
    expect(after.queuedAt).toBeNull();
    expect(
      await db()
        .select()
        .from(workflowsOutbox)
        .where(
          and(
            eq(workflowsOutbox.eventType, WORKFLOWS_JOB_EXECUTION_QUEUED),
            sql`${workflowsOutbox.payload}->>'jobExecutionId' = ${execution.id}`,
          ),
        ),
    ).toHaveLength(0);
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

  test.each([
    ['a boolean', true],
    ['an object', {name: 'build'}],
  ] as const)('materializes %s dynamic job outputs without stringifying them', async (_label, value) => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: {payload: template('steps.collect.outputs.payload')},
            outputTypes: {payload: {kind: 'dyn'}},
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
    await finishCollectedStep(job.id, {payload: value});

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved.outputs).toEqual({payload: value});
    const persisted = await getFirstJobExecutionByJobId(job.id);
    expect(persisted?.outputs).toEqual({payload: value});
  });

  test('persists job outputs in the raised size band when execution succeeds', async () => {
    const outputKeys = ['one', 'two', 'three'];
    const outputValues = Object.fromEntries(
      outputKeys.map((key) => [key, 'x'.repeat(MAX_JOB_OUTPUT_VALUE_BYTES)]),
    );
    const outputTemplates = Object.fromEntries(
      outputKeys.map((key) => [key, template(`steps.collect.outputs.${key}`)]),
    );
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: outputTemplates,
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
    await finishCollectedStep(job.id, outputValues);

    const resolved = await updateJobExecutionStatus({
      jobExecutionId: execution.id,
      status: 'succeeded',
      expectedVersion: execution.version,
    });

    expect(resolved).toMatchObject({status: 'succeeded', outputs: outputValues});
    const persisted = await getFirstJobExecutionByJobId(job.id);
    expect(persisted?.outputs).toEqual(outputValues);
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

  test('fails a successful execution when a materialized job output cannot be resolved', async () => {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId,
      model: buildModel({
        jobs: {
          build: {
            steps: [{key: 'collect', run: 'echo build'}],
            outputs: {payload: template('steps.collect.outputs.missing')},
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

    expect(resolved).toMatchObject({
      status: 'failed',
      statusReason: 'output_invalid',
      statusReasonMessage: expect.stringContaining(
        'job.outputs uses `steps.collect.outputs.missing`',
      ),
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

    expect(resolved).toMatchObject({
      status: 'failed',
      statusReason: 'output_invalid',
      statusReasonMessage: `Job outputs cannot define more than ${MAX_JOB_OUTPUT_ENTRIES} entries (found ${MAX_JOB_OUTPUT_ENTRIES + 1})`,
      outputs: null,
    });
  });
});

describe('classifyJobOutputFailure', () => {
  test.each([
    [
      new InterpolationUnresolvableError('definition-1', {
        field: 'job.outputs',
        source: 'steps.collect.outputs.payload',
      }),
      'output_invalid',
    ],
    [new JobOutputNotJsonSafeError('payload', 'undefined is not a JSON value'), 'output_invalid'],
    [new JobOutputTooManyEntriesError(11, 10), 'output_invalid'],
    [new JobOutputTooLargeError('payload', 16 * 1024, 16 * 1024 + 1, 'value'), 'output_too_large'],
  ] as const)('classifies %s with the persisted reason', (error, statusReason) => {
    expect(classifyJobOutputFailure(error)).toMatchObject({statusReason});
  });

  test('does not classify legacy diagnostic overages as product output failures', () => {
    expect(
      classifyJobOutputFailure(
        new WorkflowDiagnosticTooLargeError('execution_outputs', 1024, 2048),
      ),
    ).toBeNull();
  });

  test('does not classify interpolation failures outside job outputs', () => {
    const error = new InterpolationUnresolvableError('definition-1', {
      field: 'env',
      source: 'event.ref',
      envKey: 'REF',
    });

    expect(classifyJobOutputFailure(error)).toBeNull();
  });

  test('does not classify unexpected failures', () => {
    expect(classifyJobOutputFailure(new Error('database unavailable'))).toBeNull();
  });

  test('bounds the persisted message', () => {
    const failure = classifyJobOutputFailure(
      new JobOutputNotJsonSafeError('payload', 'x'.repeat(4096)),
    );

    expect(failure?.statusReasonMessage).toHaveLength(2048);
    expect(failure?.statusReasonMessage.endsWith('…')).toBe(true);
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
