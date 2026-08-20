import {
  type AgentInterModuleClient,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import {
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  type WorkflowsStepAttemptTerminatedEventDto,
  type WorkflowsStepRestartEnqueuedEventDto,
} from '@shipfox/api-workflows-dto';
import {
  createWorkflowExpression,
  parseWorkflowTemplate,
  planInterpolationField,
} from '@shipfox/expression';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {and, eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {workflowsOutbox} from '#db/schema/outbox.js';
import {stepAttempts as stepAttemptsTable} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {getStepAttempts, getStepsByJobId} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {bulkUpdateJobStepStatuses} from '#test/helpers/workflow-runs.js';
import type {Step} from './entities/step.js';
import {
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
} from './errors.js';
import {
  classifyReportedStep,
  nextStepForJob,
  recordStepResult as recordJobExecutionStepResult,
} from './job-execution.js';

async function recordStepResult(
  params: Omit<Parameters<typeof recordJobExecutionStepResult>[0], 'jobExecutionId'> & {
    jobId: string;
  },
) {
  const steps = await getStepsByJobId(params.jobId);
  const step = steps.find((candidate) => candidate.id === params.stepId);
  if (!step) throw new StepNotFoundError(params.stepId, params.jobId);
  const {jobId: _jobId, ...rest} = params;
  return recordJobExecutionStepResult({...rest, jobExecutionId: step.jobExecutionId});
}

function plannedField(field: 'run' | 'step.feedback', source: string) {
  const plan = planInterpolationField({field, segments: parseWorkflowTemplate(source)});
  if (!plan.ok) throw new Error('Expected test template to plan');
  return plan.plan.field;
}

async function jobStepsSettledEvents(jobId: string): Promise<Array<{status: string}>> {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_JOB_STEPS_SETTLED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload as {status: string});
}

async function stepAttemptTerminatedEvents(
  jobId: string,
): Promise<WorkflowsStepAttemptTerminatedEventDto[]> {
  const rows = await db()
    .select({payload: workflowsOutbox.payload})
    .from(workflowsOutbox)
    .where(
      and(
        eq(workflowsOutbox.eventType, WORKFLOWS_STEP_ATTEMPT_TERMINATED),
        sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
      ),
    );
  return rows.map((row) => row.payload as WorkflowsStepAttemptTerminatedEventDto);
}

function stepForClassification(params: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    jobExecutionId: 'job-execution-1',
    key: 'build',
    name: 'Build',
    sourceLocation: null,
    status: 'running',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {run: 'echo ok'},
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...params,
  };
}

describe('nextStepForJob', () => {
  test('returns the lowest-position pending step and marks it running', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: steps[0]?.id}),
      dispatched: true,
    });
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running');
    expect(after[1]?.status).toBe('pending');
    expect(after[2]?.status).toBe('pending');
  });

  test('idempotent re-delivery: a second pull returns the same running step', async () => {
    const {jobId} = await arrangeJobWithSteps(3);
    const first = await nextStepForJob(jobId);

    const second = await nextStepForJob(jobId);

    expect(first.kind).toBe('step');
    expect(second.kind).toBe('step');
    const firstId = first.kind === 'step' ? first.step.id : null;
    const secondId = second.kind === 'step' ? second.step.id : null;
    expect(secondId).toBe(firstId);
    expect(first.kind === 'step' ? first.dispatched : undefined).toBe(true);
    expect(second.kind === 'step' ? second.dispatched : undefined).toBe(false);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
  });

  test('after a step succeeds, the next pull returns the next pending step', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const next = await nextStepForJob(jobId);

    expect(next).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: steps[1]?.id}),
      dispatched: true,
    });
  });

  test('fills dispatch config from terminal step attempt output', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const producer = steps[0];
    const consumer = steps[1];
    if (!producer || !consumer) throw new Error('Expected arranged steps');
    const shaPlan = stepOutputField('build', 'sha');
    await db().update(stepsTable).set({key: 'build'}).where(eq(stepsTable.id, producer.id));
    await db()
      .update(stepsTable)
      .set({
        key: 'deploy',
        config: {run: 'echo ok'},
        configPlan: {env: {SHA: shaPlan}},
      })
      .where(eq(stepsTable.id, consumer.id));
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: producer.id,
      status: 'succeeded',
      output: {sha: 'abc123'},
    });

    const next = await nextStepForJob(jobId);
    const redelivery = await nextStepForJob(jobId);

    expect(next).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: consumer.id,
        config: {run: 'echo ok', env: {SHA: 'abc123'}},
        configPlan: {env: {SHA: shaPlan}},
      }),
      dispatched: true,
    });
    expect(redelivery).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: consumer.id,
        config: {run: 'echo ok', env: {SHA: 'abc123'}},
        configPlan: {env: {SHA: shaPlan}},
      }),
      dispatched: false,
    });
    const attempts = await getStepAttempts(jobId);
    expect(attempts.find((attempt) => attempt.stepId === consumer.id)).toMatchObject({
      status: 'running',
      config: {run: 'echo ok', env: {SHA: 'abc123'}},
    });
    const after = await getStepsByJobId(jobId);
    expect(after.find((step) => step.id === consumer.id)?.configPlan).toEqual({
      env: {SHA: shaPlan},
    });
  });

  test('re-materializes dispatch config after a gate rewind', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const producer = steps[0];
    const consumer = steps[1];
    if (!producer || !consumer) throw new Error('Expected arranged steps');
    const shaPlan = stepOutputField('build', 'sha');
    await db().update(stepsTable).set({key: 'build'}).where(eq(stepsTable.id, producer.id));
    await db()
      .update(stepsTable)
      .set({
        key: 'deploy',
        config: {
          run: 'deploy',
          gate: {
            success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
            on_failure: {restart_from: 'build'},
          },
        },
        configPlan: {env: {SHA: shaPlan}},
      })
      .where(eq(stepsTable.id, consumer.id));

    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: producer.id,
      status: 'succeeded',
      output: {sha: 'abc123'},
    });
    const firstConsumer = await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: consumer.id,
      status: 'failed',
      error: {message: 'exit 1'},
      exitCode: 1,
    });
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: producer.id,
      status: 'succeeded',
      output: {sha: 'def456'},
    });

    const secondConsumer = await nextStepForJob(jobId);

    expect(firstConsumer).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: consumer.id,
        currentAttempt: 1,
        config: expect.objectContaining({env: {SHA: 'abc123'}}),
      }),
      dispatched: true,
    });
    expect(secondConsumer).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: consumer.id,
        currentAttempt: 2,
        config: expect.objectContaining({env: {SHA: 'def456'}}),
        configPlan: {env: {SHA: shaPlan}},
      }),
      dispatched: true,
    });
    const attempts = await getStepAttempts(jobId);
    expect(
      attempts.find((attempt) => attempt.stepId === consumer.id && attempt.attempt === 1),
    ).toMatchObject({config: expect.objectContaining({env: {SHA: 'abc123'}})});
    expect(
      attempts.find((attempt) => attempt.stepId === consumer.id && attempt.attempt === 2),
    ).toMatchObject({config: expect.objectContaining({env: {SHA: 'def456'}})});
  });

  test('fails the job when dispatch config cannot resolve a peer output', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const producer = steps[0];
    const consumer = steps[1];
    if (!producer || !consumer) throw new Error('Expected arranged steps');
    await db().update(stepsTable).set({key: 'build'}).where(eq(stepsTable.id, producer.id));
    await db()
      .update(stepsTable)
      .set({
        key: 'deploy',
        config: {run: 'echo ok'},
        configPlan: {env: {SHA: stepOutputField('build', 'sha')}},
      })
      .where(eq(stepsTable.id, consumer.id));
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: producer.id, status: 'succeeded', output: {}});

    const next = await nextStepForJob(jobId);

    expect(next).toEqual({kind: 'done', status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after.find((step) => step.id === consumer.id)).toMatchObject({
      status: 'failed',
      error: {
        reason: 'config_unresolvable',
        field: 'env.SHA',
        source: 'steps.build.outputs.sha',
      },
    });
    const attempts = await getStepAttempts(jobId);
    expect(attempts.find((attempt) => attempt.stepId === consumer.id)).toMatchObject({
      status: 'failed',
      config: null,
      error: {
        reason: 'config_unresolvable',
        field: 'env.SHA',
        source: 'steps.build.outputs.sha',
      },
      logOutcome: 'abandoned',
    });
  });

  test('reports managed provider policy failures as agent config errors', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const pending = steps[0];
    if (!pending) throw new Error('Expected pending step');
    await db()
      .update(stepsTable)
      .set({
        config: {},
        configPlan: {
          agent: {
            prompt: {segments: [{kind: 'literal', value: 'Review the change.'}]},
          },
        },
      })
      .where(eq(stepsTable.id, pending.id));

    const agent = {
      getValidationCatalog: vi.fn(),
      resolveAgentConfig: vi.fn().mockRejectedValue(
        createInterModuleKnownError(
          agentInterModuleContract.methods.resolveAgentConfig,
          'agent-config-invalid',
          {
            message: 'This instance only supports provider `shipfox`.',
            managed_provider_id: 'shipfox',
          },
        ),
      ),
      resolveRuntimeCredentials: vi.fn(),
    } as unknown as AgentInterModuleClient;

    const next = await nextStepForJob(jobId, agent);

    expect(next).toEqual({kind: 'done', status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after[0]).toMatchObject({
      status: 'failed',
      error: {
        message: 'This instance only supports provider `shipfox`.',
        reason: 'agent_config_invalid',
        field: 'agent',
        source: 'agent',
        code: 'workspace-providers-disabled',
        managedProviderId: 'shipfox',
        agentConfigIssue: 'provider_unsupported',
      },
    });
  });

  test('all steps succeeded → {done, succeeded}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    for (const step of steps) {
      await nextStepForJob(jobId);
      await recordStepResult({jobId, stepId: step.id, status: 'succeeded'});
    }

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'succeeded'});
  });

  test('unknown jobId → JobNotFoundError (not a vacuous done)', async () => {
    await expect(nextStepForJob(crypto.randomUUID())).rejects.toBeInstanceOf(JobNotFoundError);
  });

  test('all terminal with a failure → {done, failed}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'failed'});
  });

  test('all cancelled, none failed → {done, succeeded}', async () => {
    const {jobId} = await arrangeJobWithSteps(2);
    await bulkUpdateJobStepStatuses({jobId, status: 'cancelled'});

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'succeeded'});
  });

  test('skips a false condition without creating an attempt and dispatches the next step', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const skippedStep = steps[0];
    const runnableStep = steps[1];
    if (!skippedStep || !runnableStep) throw new Error('Expected arranged steps');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('false')})
      .where(eq(stepsTable.id, skippedStep.id));

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: runnableStep.id}),
      dispatched: true,
    });
    const after = await getStepsByJobId(jobId);
    expect(after.find((step) => step.id === skippedStep.id)).toMatchObject({
      status: 'skipped',
      statusReason: 'condition_rejected',
      evaluationTrace: [conditionTrace('step.if', 'false', [], false)],
    });
    expect(after.find((step) => step.id === runnableStep.id)?.status).toBe('running');
    expect(await getStepAttempts(jobId)).toMatchObject([{stepId: runnableStep.id}]);
  });

  test('skips an errored condition without creating an attempt', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const skippedStep = steps[0];
    const runnableStep = steps[1];
    if (!skippedStep || !runnableStep) throw new Error('Expected arranged steps');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('1 / 0 == 0')})
      .where(eq(stepsTable.id, skippedStep.id));

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: runnableStep.id}),
      dispatched: true,
    });
    const after = await getStepsByJobId(jobId);
    expect(after.find((step) => step.id === skippedStep.id)).toMatchObject({
      status: 'skipped',
      statusReason: 'condition_errored',
      evaluationTrace: [conditionTrace('step.if', '1 / 0 == 0', [], false, true)],
    });
    expect(await getStepAttempts(jobId)).toMatchObject([{stepId: runnableStep.id}]);
  });

  test('skips adjacent false conditions in one pull and keeps condition out of runner config', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const [first, second, third] = steps;
    if (!first || !second || !third) throw new Error('Expected arranged steps');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('false')})
      .where(sql`${stepsTable.id} = ${first.id} OR ${stepsTable.id} = ${second.id}`);

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: third.id}),
      dispatched: true,
    });
    if (result.kind !== 'step') throw new Error('Expected a runnable step');
    expect(result.step.config).not.toHaveProperty('if');
    expect(result.step.condition).toBeNull();
    const after = await getStepsByJobId(jobId);
    expect(after.map((step) => step.status)).toEqual(['skipped', 'skipped', 'running']);
    expect(await getStepAttempts(jobId)).toMatchObject([{stepId: third.id}]);
  });

  test('a job with only author-skipped steps resolves succeeded', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const [onlyStep] = steps;
    if (!onlyStep) throw new Error('Expected arranged step');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('false')})
      .where(eq(stepsTable.id, onlyStep.id));

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'succeeded'});
    const after = await getStepsByJobId(jobId);
    expect(after).toMatchObject([{status: 'skipped', statusReason: 'condition_rejected'}]);
    expect(await getStepAttempts(jobId)).toHaveLength(0);
    expect(await jobStepsSettledEvents(jobId)).toMatchObject([{status: 'succeeded'}]);
  });

  test('the implicit default gate skips when execution.failed is true', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const failed = steps[0];
    const defaultGated = steps[1];
    if (!failed || !defaultGated) throw new Error('Expected arranged steps');
    await db().update(stepsTable).set({status: 'failed'}).where(eq(stepsTable.id, failed.id));

    const result = await nextStepForJob(jobId);

    expect(result).toEqual({kind: 'done', status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after.find((step) => step.id === defaultGated.id)).toMatchObject({
      status: 'skipped',
      statusReason: 'default_gate_rejected',
      evaluationTrace: [
        {
          expression: '!execution.failed',
          roots: ['execution'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          value: 'false',
          field: 'step.default_gate',
        },
      ],
    });
  });
});

function conditionExpression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

function conditionTrace(
  field: 'step.if',
  expression: string,
  roots: string[],
  value: boolean,
  degraded = false,
) {
  return {
    expression,
    roots,
    fillTarget: 'step-dispatch',
    evaluatedAt: 'step-dispatch',
    value: String(value),
    ...(degraded ? {degraded: true} : {}),
    field,
  };
}

function stepOutputField(stepKey: string, outputKey: string) {
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

describe('classifyReportedStep', () => {
  it('allows a report for the current running attempt', () => {
    const step = stepForClassification({status: 'running', currentAttempt: 2});

    const result = classifyReportedStep(step, 2, 'job-1');

    expect(result).toBe('proceed');
  });

  it('rejects a report ahead of the current attempt', () => {
    const step = stepForClassification({currentAttempt: 2});

    const result = classifyReportedStep(step, 3, 'job-1');

    expect(result).toBeInstanceOf(StepAttemptAheadError);
    expect(result).toMatchObject({stepId: step.id, jobId: 'job-1'});
  });

  it('ignores a stale report from an older attempt', () => {
    const step = stepForClassification({currentAttempt: 2});

    const result = classifyReportedStep(step, 1, 'job-1');

    expect(result).toBe('noop');
  });

  it.each([
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
  ] as const)('ignores duplicate reports for a %s step', (status) => {
    const step = stepForClassification({status});

    const result = classifyReportedStep(step, 1, 'job-1');

    expect(result).toBe('noop');
  });

  it('rejects a report for a pending step', () => {
    const step = stepForClassification({status: 'pending'});

    const result = classifyReportedStep(step, 1, 'job-1');

    expect(result).toBeInstanceOf(StepNotRunningError);
  });
});

describe('recordStepResult', () => {
  test('succeeded on a non-final step → {jobFinished:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    expect((await getStepsByJobId(jobId))[0]?.status).toBe('succeeded');
  });

  test('succeeded on the final step → {jobFinished:true, succeeded}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
  });

  test('failed step → step failed, remaining pending, {jobFinished:false}', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[0]?.error).toEqual({message: 'boom'});
    expect(after[1]?.status).toBe('pending');
    expect(after[2]?.status).toBe('pending');
  });

  test('after a failure, default-gated pending steps skip and finish the failed job', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    const done = await nextStepForJob(jobId);

    expect(done).toEqual({kind: 'done', status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after.map((step) => step.status)).toEqual(['failed', 'skipped', 'skipped']);
    expect(after[1]?.statusReason).toBe('default_gate_rejected');
    expect(after[2]?.statusReason).toBe('default_gate_rejected');
    expect(await jobStepsSettledEvents(jobId)).toMatchObject([{status: 'failed'}]);
  });

  test('after a failure, if:true cleanup still runs before the job resolves failed', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    const cleanup = steps[1];
    if (!cleanup) throw new Error('Expected cleanup step');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('true')})
      .where(eq(stepsTable.id, cleanup.id));
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    const next = await nextStepForJob(jobId);

    expect(next).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: cleanup.id}),
      dispatched: true,
    });
    await recordStepResult({jobId, stepId: cleanup.id, status: 'succeeded'});
    const done = await nextStepForJob(jobId);
    expect(done).toEqual({kind: 'done', status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after.map((step) => step.status)).toEqual(['failed', 'succeeded', 'skipped']);
    expect(after[2]?.statusReason).toBe('default_gate_rejected');
  });

  test('if:execution.failed runs only after an earlier step failed', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const upload = steps[1];
    if (!upload) throw new Error('Expected upload step');
    await db()
      .update(stepsTable)
      .set({condition: conditionExpression('execution.failed')})
      .where(eq(stepsTable.id, upload.id));
    await nextStepForJob(jobId);
    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    const next = await nextStepForJob(jobId);

    expect(next).toEqual({
      kind: 'step',
      step: expect.objectContaining({id: upload.id}),
      dispatched: true,
    });
    await recordStepResult({jobId, stepId: upload.id, status: 'succeeded'});
    expect(await nextStepForJob(jobId)).toEqual({kind: 'done', status: 'failed'});
  });

  test('never downgrades an already-terminal row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    // A late 'failed' report for the already-succeeded step must not downgrade it.
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('unknown stepId → StepNotFoundError', async () => {
    const {jobId} = await arrangeJobWithSteps(1);

    await expect(
      recordStepResult({jobId, stepId: crypto.randomUUID(), status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  test('cross-job stepId → StepNotFoundError', async () => {
    const a = await arrangeJobWithSteps(1);
    const b = await arrangeJobWithSteps(1);

    await expect(
      recordStepResult({jobId: a.jobId, stepId: b.steps[0]?.id as string, status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotFoundError);
  });

  test('result for a pending (never-dispatched) step → StepNotRunningError', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    // Skip nextStepForJob so the step stays pending (never handed out).

    await expect(
      recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'}),
    ).rejects.toBeInstanceOf(StepNotRunningError);
  });

  test('duplicate succeeded report is a no-op', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('succeeded');
    expect(after[1]?.status).toBe('pending');
  });

  test('duplicate failed report is a no-op and later steps remain dispatchable', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(3);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'failed'});

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('failed');
    expect(after[1]?.status).toBe('pending');
    expect(after[2]?.status).toBe('pending');
    expect(await jobStepsSettledEvents(jobId)).toHaveLength(0);
  });

  test('coerces declared output before persisting and filling later step config', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const producer = steps[0];
    const consumer = steps[1];
    if (!producer || !consumer) throw new Error('Expected arranged steps');
    const countPlan = stepOutputField('build', 'count');
    await db()
      .update(stepsTable)
      .set({
        key: 'build',
        config: {run: 'build', outputs: {count: {type: 'number'}}},
      })
      .where(eq(stepsTable.id, producer.id));
    await db()
      .update(stepsTable)
      .set({
        key: 'deploy',
        config: {run: 'deploy'},
        configPlan: {env: {COUNT: countPlan}},
      })
      .where(eq(stepsTable.id, consumer.id));
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: producer.id,
      status: 'succeeded',
      output: {count: '42'},
    });
    const next = await nextStepForJob(jobId);

    const attempts = await getStepAttempts(jobId);
    expect(attempts.find((attempt) => attempt.stepId === producer.id)).toMatchObject({
      status: 'succeeded',
      output: {count: 42},
    });
    expect(next).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: consumer.id,
        config: {run: 'deploy', env: {COUNT: '42'}},
      }),
      dispatched: true,
    });
  });

  test('coerces JSON output against its declared schema', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await db()
      .update(stepsTable)
      .set({
        config: {
          run: 'build',
          outputs: {
            meta: {
              type: 'json',
              schema: {
                type: 'object',
                properties: {
                  registry: {type: 'string'},
                  size_bytes: {type: 'integer'},
                },
                required: ['registry', 'size_bytes'],
                additionalProperties: false,
              },
            },
          },
        },
      })
      .where(eq(stepsTable.id, stepId));
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {meta: '{"registry":"ghcr.io","size_bytes":"42"}'},
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({meta: {registry: 'ghcr.io', size_bytes: 42}});
  });

  it.each([
    ['missing declared key', {}, 'outputs.count'],
    ['undeclared emitted key', {count: '1', extra: 'nope'}, 'outputs.extra'],
    ['non-parsing scalar', {count: 'nope'}, 'outputs.count'],
  ])('fails declared output report for %s', async (_label, output, field) => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await db()
      .update(stepsTable)
      .set({config: {run: 'build', outputs: {count: {type: 'number'}}}})
      .where(eq(stepsTable.id, stepId));
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({jobId, stepId, status: 'succeeded', output});

    expect(outcome).toEqual({jobFinished: true, status: 'failed'});
    const after = await getStepsByJobId(jobId);
    expect(after[0]).toMatchObject({
      status: 'failed',
      error: {reason: 'output_invalid', field},
    });
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'failed',
      output: null,
      error: {reason: 'output_invalid', field},
    });
  });

  test('keeps untyped steps open to arbitrary output keys', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {count: 'not typed', extra: 'allowed'},
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({count: 'not typed', extra: 'allowed'});
  });
});

describe('nextStepForJob concurrency', () => {
  test('concurrent pulls return the same step', async () => {
    const {jobId} = await arrangeJobWithSteps(3);

    const [a, b] = await Promise.all([nextStepForJob(jobId), nextStepForJob(jobId)]);

    expect(a.kind).toBe('step');
    expect(b.kind).toBe('step');
    const idA = a.kind === 'step' ? a.step.id : null;
    const idB = b.kind === 'step' ? b.step.id : null;
    expect(idA).toBe(idB);
    const running = (await getStepsByJobId(jobId)).filter((s) => s.status === 'running');
    expect(running).toHaveLength(1);
    // The onConflictDoNothing backstop keeps a single attempt row under contention.
    expect(await getStepAttempts(jobId)).toMatchObject([{executionOrder: 1}]);
  });
});

describe('recordStepResult job-completion event', () => {
  test('enqueues exactly one job-completed event when the final step finishes the job', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const events = await jobStepsSettledEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('succeeded');
  });

  test('does not enqueue a completion event while steps remain', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(outcome).toEqual({jobFinished: false});
    expect(await jobStepsSettledEvents(jobId)).toHaveLength(0);
  });

  test('a failed final step enqueues one completion event with status failed', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    const events = await jobStepsSettledEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('failed');
  });

  test('a failed non-final step enqueues completion only after remaining steps skip', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
    });

    expect(await jobStepsSettledEvents(jobId)).toHaveLength(0);

    await nextStepForJob(jobId);

    const events = await jobStepsSettledEvents(jobId);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('failed');
  });

  test('a duplicate final report does not enqueue a second completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded'});

    const duplicate = await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
    });

    expect(duplicate).toEqual({jobFinished: true, status: 'succeeded'});
    expect(await jobStepsSettledEvents(jobId)).toHaveLength(1);
  });

  test('concurrent final reports enqueue exactly one completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    const outcomes = await Promise.all([
      recordStepResult({jobId, stepId, status: 'succeeded', attempt: 1, exitCode: 0}),
      recordStepResult({jobId, stepId, status: 'succeeded', attempt: 1, exitCode: 0}),
    ]);

    expect(outcomes).toEqual([
      {jobFinished: true, status: 'succeeded'},
      {jobFinished: true, status: 'succeeded'},
    ]);
    expect(await jobStepsSettledEvents(jobId)).toHaveLength(1);
  });
});

describe('step attempts', () => {
  test('dispatch opens a running attempt row at attempt 1', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);

    await nextStepForJob(jobId);

    const attempts = await getStepAttempts(jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      stepId: steps[0]?.id,
      attempt: 1,
      executionOrder: 1,
      status: 'running',
    });
  });

  test('re-delivery does not open a second attempt row', async () => {
    const {jobId} = await arrangeJobWithSteps(2);

    await nextStepForJob(jobId);
    await nextStepForJob(jobId);

    expect(await getStepAttempts(jobId)).toHaveLength(1);
  });

  test('reporting finalizes the attempt with status and exit code', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'succeeded',
      exitCode: 0,
    });

    const attempts = await getStepAttempts(jobId);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({attempt: 1, status: 'succeeded', exitCode: 0, error: null});
    expect(attempts[0]?.finishedAt).not.toBeNull();
    const [step] = await getStepsByJobId(jobId);
    expect(step?.currentAttempt).toBe(attempts[0]?.attempt);
    expect(step?.status).toBe(attempts[0]?.status);
  });

  test('reporting stores agent response independently of structured output', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      response: 'The implementation is complete.',
      output: {summary: 'done'},
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'succeeded',
      response: 'The implementation is complete.',
      output: {summary: 'done'},
    });
  });

  test('response survives output_invalid coercion failure', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await db()
      .update(stepsTable)
      .set({config: {run: 'build', outputs: {count: {type: 'number'}}}})
      .where(eq(stepsTable.id, stepId));
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      response: 'I could not infer the numeric count.',
      output: {count: 'not-a-number'},
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'failed',
      response: 'I could not infer the numeric count.',
      output: null,
      error: {reason: 'output_invalid'},
    });
  });

  test('reporting stores log outcome and emits the terminal attempt log identity once', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'boom'},
      logOutcome: 'abandoned',
    });
    await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'boom'},
      logOutcome: 'abandoned',
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({attempt: 1, status: 'failed', logOutcome: 'abandoned'});
    expect(await stepAttemptTerminatedEvents(jobId)).toEqual([
      {
        jobId,
        workflowRunId: expect.any(String),
        workflowRunAttemptId: expect.any(String),
        workspaceId: expect.any(String),
        projectId: expect.any(String),
        stepId,
        attempt: 1,
        status: 'failed',
        logOutcome: 'abandoned',
      },
    ]);
  });

  test('a failed report finalizes the attempt with its error and exit code', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId: steps[0]?.id as string,
      status: 'failed',
      error: {message: 'boom'},
      exitCode: 1,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({status: 'failed', exitCode: 1, error: {message: 'boom'}});
  });

  test('reporting creates a missing running attempt before finalization', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    // A step may already be running before its attempt row exists. Reporting
    // should backfill the attempt row and finalize it.
    await db().update(stepsTable).set({status: 'running'}).where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {summary: 'ok'},
      exitCode: 0,
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      stepId,
      attempt: 1,
      status: 'succeeded',
      output: {summary: 'ok'},
      exitCode: 0,
    });
    const [step] = await getStepsByJobId(jobId);
    expect(step?.currentAttempt).toBe(attempt?.attempt);
    expect(step?.status).toBe(attempt?.status);
  });

  test('persists structured output on the attempt row', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    await recordStepResult({
      jobId,
      stepId,
      status: 'succeeded',
      output: {artifact: 'dist/app.tgz'},
      exitCode: 0,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.output).toEqual({artifact: 'dist/app.tgz'});
  });

  test('a duplicate report leaves the finalized attempt unchanged (never-downgrade)', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId, status: 'succeeded', exitCode: 0});

    await recordStepResult({jobId, stepId, status: 'failed', exitCode: 9});

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({status: 'succeeded', exitCode: 0});
  });

  test('rejects non-positive attempt rows at the database boundary', async () => {
    const {steps} = await arrangeJobWithSteps(1);
    const jobExecutionId = steps[0]?.jobExecutionId as string;

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobExecutionId,
          stepId: steps[0]?.id as string,
          attempt: 0,
          executionOrder: 1,
          status: 'running',
        }),
    ).rejects.toThrow();
  });

  test('rejects non-positive execution order rows at the database boundary', async () => {
    const {steps} = await arrangeJobWithSteps(1);
    const jobExecutionId = steps[0]?.jobExecutionId as string;

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobExecutionId,
          stepId: steps[0]?.id as string,
          attempt: 1,
          executionOrder: 0,
          status: 'running',
        }),
    ).rejects.toThrow();
  });

  test('rejects duplicate execution order rows for the same execution', async () => {
    const {steps} = await arrangeJobWithSteps(2);
    const jobExecutionId = steps[0]?.jobExecutionId as string;

    await db()
      .insert(stepAttemptsTable)
      .values({
        jobExecutionId,
        stepId: steps[0]?.id as string,
        attempt: 1,
        executionOrder: 1,
        status: 'running',
      });

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobExecutionId,
          stepId: steps[1]?.id as string,
          attempt: 1,
          executionOrder: 1,
          status: 'running',
        }),
    ).rejects.toThrow();
  });

  test('rejects pending attempt rows at the database boundary', async () => {
    const {steps} = await arrangeJobWithSteps(1);
    const jobExecutionId = steps[0]?.jobExecutionId as string;

    await expect(
      db()
        .insert(stepAttemptsTable)
        .values({
          jobExecutionId,
          stepId: steps[0]?.id as string,
          attempt: 1,
          executionOrder: 1,
          status: 'pending',
        }),
    ).rejects.toThrow();
  });

  test('rejects a report whose attempt is ahead of the current attempt', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    await nextStepForJob(jobId);

    await expect(
      recordStepResult({jobId, stepId: steps[0]?.id as string, status: 'succeeded', attempt: 2}),
    ).rejects.toBeInstanceOf(StepAttemptAheadError);
  });

  test('a stale older-attempt report is an idempotent no-op', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);

    await db()
      .update(stepsTable)
      .set({currentAttempt: 2, status: 'running'})
      .where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'late'},
      attempt: 1,
    });

    expect(outcome).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after[0]?.status).toBe('running'); // projection untouched by the stale report
  });

  test('a stale report on an already-finished job reports finished without a second completion event', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await nextStepForJob(jobId);
    await recordStepResult({jobId, stepId, status: 'succeeded', exitCode: 0});
    await db().update(stepsTable).set({currentAttempt: 2}).where(eq(stepsTable.id, stepId));

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'late'},
      attempt: 1,
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    // The applied-gated outbox write must not fire on the stale path.
    expect(await jobStepsSettledEvents(jobId)).toHaveLength(1);
  });
});

describe('gate evaluation', () => {
  async function attachGate(stepId: string, gate: Record<string, unknown>): Promise<void> {
    await db()
      .update(stepsTable)
      .set({config: {run: 'echo hi', gate}})
      .where(eq(stepsTable.id, stepId));
  }

  test('a passing gate succeeds a step despite a non-zero command exit', async () => {
    const {jobId, steps} = await arrangeJobWithSteps(1);
    const stepId = steps[0]?.id as string;
    await attachGate(stepId, {
      success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 1'},
    });
    await nextStepForJob(jobId);

    const outcome = await recordStepResult({
      jobId,
      stepId,
      status: 'failed',
      error: {message: 'exit 1'},
      exitCode: 1,
    });

    expect(outcome).toEqual({jobFinished: true, status: 'succeeded'});
    expect((await getStepsByJobId(jobId))[0]?.status).toBe('succeeded');
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.gateResult).toMatchObject({passed: true});
  });
});

describe('durable gate restart', () => {
  async function restartEvents(jobId: string): Promise<WorkflowsStepRestartEnqueuedEventDto[]> {
    const rows = await db()
      .select({payload: workflowsOutbox.payload})
      .from(workflowsOutbox)
      .where(
        and(
          eq(workflowsOutbox.eventType, WORKFLOWS_STEP_RESTART_ENQUEUED),
          sql`${workflowsOutbox.payload}->>'jobId' = ${jobId}`,
        ),
      );
    return rows.map((row) => row.payload as WorkflowsStepRestartEnqueuedEventDto);
  }

  async function restartEventCount(jobId: string): Promise<number> {
    return (await restartEvents(jobId)).length;
  }

  // producer (named) → reviewer (gated `success: step.exit_code == 0`, on_failure restart_from producer)
  async function arrangeGatedJob(params: {
    source: string;
    outputs?: Record<string, unknown>;
    feedback?: string;
    feedbackTemplate?: ReturnType<typeof plannedField>;
  }): Promise<{jobId: string; producer: string; reviewer: string}> {
    const {jobId, steps} = await arrangeJobWithSteps(2);
    const producer = steps[0]?.id as string;
    const reviewer = steps[1]?.id as string;
    await db().update(stepsTable).set({key: 'producer'}).where(eq(stepsTable.id, producer));
    await db()
      .update(stepsTable)
      .set({
        config: {
          run: 'review',
          ...(params.outputs === undefined ? {} : {outputs: params.outputs}),
          gate: {
            success: {language: 'cel', check: 'syntax', source: params.source},
            on_failure: {
              restart_from: 'producer',
              ...(params.feedback === undefined ? {} : {feedback: params.feedback}),
              ...(params.feedbackTemplate === undefined
                ? {}
                : {feedback_template: params.feedbackTemplate}),
            },
          },
        },
      })
      .where(eq(stepsTable.id, reviewer));
    return {jobId, producer, reviewer};
  }

  async function runStep(jobId: string, stepId: string, exitCode: number, response?: string) {
    await nextStepForJob(jobId);
    return recordStepResult({
      jobId,
      stepId,
      status: exitCode === 0 ? 'succeeded' : 'failed',
      ...(exitCode === 0 ? {} : {error: {message: `exit ${exitCode}`}}),
      exitCode,
      ...(response === undefined ? {} : {response}),
    });
  }

  test('a failing gate rewinds the job to the restart_from step, keeping it running', async () => {
    const {jobId, producer, reviewer} = await arrangeGatedJob({source: 'step.exit_code == 0'});

    await runStep(jobId, producer, 0); // producer succeeds, attempt 1
    const restart = await runStep(jobId, reviewer, 1, 'Needs another build.'); // reviewer gate fails → restart

    expect(restart).toEqual({jobFinished: false});
    const after = await getStepsByJobId(jobId);
    expect(after.map((s) => s.status)).toEqual(['pending', 'pending']); // rewound
    expect(after.every((s) => s.currentAttempt === 2)).toBe(true); // bumped
    expect(await restartEventCount(jobId)).toBe(1);
    // History preserved.
    const attempts = await getStepAttempts(jobId);
    expect(attempts.find((a) => a.stepId === producer && a.attempt === 1)?.status).toBe(
      'succeeded',
    );
    const reviewerAttempt = attempts.find((a) => a.stepId === reviewer && a.attempt === 1);
    expect(reviewerAttempt?.status).toBe('failed');
    expect(reviewerAttempt?.response).toBe('Needs another build.');
    expect(reviewerAttempt?.restartFeedback).toBeTruthy();
  });

  test('a retried step materializes restart feedback and source attempt output', async () => {
    const {jobId, producer, reviewer} = await arrangeGatedJob({
      source: 'step.exit_code == 0',
      feedback: 'failed',
      feedbackTemplate: plannedField('step.feedback', `failed: \${{ step.outputs.summary }}`),
    });
    await db()
      .update(stepsTable)
      .set({
        configPlan: {
          run: plannedField(
            'run',
            `fix \${{ step.is_retry ? step.restart.feedback : 'fresh' }} from \${{ step.is_retry ? step.restart.from.outputs.summary : 'none' }}`,
          ),
        },
      })
      .where(eq(stepsTable.id, producer));

    await runStep(jobId, producer, 0);
    await nextStepForJob(jobId);
    const restart = await recordStepResult({
      jobId,
      stepId: reviewer,
      status: 'failed',
      output: {summary: 'unit failed'},
      exitCode: 1,
    });
    const retry = await nextStepForJob(jobId);

    expect(restart).toEqual({jobFinished: false});
    expect(retry).toEqual({
      kind: 'step',
      step: expect.objectContaining({
        id: producer,
        config: {
          run: `fix "\${__sf_2}" from "\${__sf_3}"`,
          env: expect.objectContaining({
            __sf_2: 'failed: unit failed',
            __sf_3: 'unit failed',
          }),
        },
      }),
      dispatched: true,
    });
    const attempts = await getStepAttempts(jobId);
    const reviewerAttempt = attempts.find((attempt) => attempt.stepId === reviewer);
    expect(reviewerAttempt?.restartFeedback).toBe('failed: unit failed');
  });

  test('a passing rerun after a restart completes the job', async () => {
    const {jobId, producer, reviewer} = await arrangeGatedJob({source: 'step.exit_code == 0'});

    await runStep(jobId, producer, 0);
    await runStep(jobId, reviewer, 1); // restart
    await runStep(jobId, producer, 0); // attempt 2
    const done = await runStep(jobId, reviewer, 0); // gate passes

    expect(done).toEqual({jobFinished: true, status: 'succeeded'});
    expect((await getStepsByJobId(jobId)).map((s) => s.status)).toEqual(['succeeded', 'succeeded']);
    expect(
      (await getStepAttempts(jobId)).map((attempt) => ({
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        executionOrder: attempt.executionOrder,
      })),
    ).toEqual([
      {stepId: producer, attempt: 1, executionOrder: 1},
      {stepId: reviewer, attempt: 1, executionOrder: 2},
      {stepId: producer, attempt: 2, executionOrder: 3},
      {stepId: reviewer, attempt: 2, executionOrder: 4},
    ]);
  });

  test('a duplicate report of a superseded attempt does not restart twice', async () => {
    const {jobId, producer, reviewer} = await arrangeGatedJob({source: 'step.exit_code == 0'});

    await runStep(jobId, producer, 0);
    await runStep(jobId, reviewer, 1); // restart (reviewer now pending at attempt 2)

    // Late duplicate of reviewer attempt 1.
    const dup = await recordStepResult({
      jobId,
      stepId: reviewer,
      status: 'failed',
      error: {message: 'late'},
      exitCode: 1,
      attempt: 1,
    });

    expect(dup).toEqual({jobFinished: false}); // stale no-op
    expect(await restartEventCount(jobId)).toBe(1);
  });
});
