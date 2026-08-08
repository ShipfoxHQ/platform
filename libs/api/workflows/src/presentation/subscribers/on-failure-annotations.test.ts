import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import type {
  WorkflowsJobTerminatedEventDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  onJobTerminatedFailureAnnotation,
  onStepAttemptTerminatedFailureAnnotation,
} from './on-failure-annotations.js';

const dbMocks = vi.hoisted(() => ({
  getJobExecutionFailureOrigin: vi.fn(),
  getJobScope: vi.fn(),
  getStepAttemptDetail: vi.fn(),
  getWorkflowRunAttemptById: vi.fn(),
}));

const metricMocks = vi.hoisted(() => ({recordWorkflowFailureAnnotationFailed: vi.fn()}));
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('#db/index.js', () => dbMocks);
vi.mock('#metrics/instance.js', () => metricMocks);
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: loggerWarn})}));

const replaceOrRemoveAnnotation = vi.fn(async () => ({}));
const annotations = {replaceOrRemoveAnnotation} as unknown as AnnotationsInterModuleClient;
const JOB_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';

describe('failure annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects a failed step attempt into an error annotation', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      exitCode: 1,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 2});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        workflowRunId: payload.workflowRunId,
        workflowRunAttempt: 2,
        workflowRunAttemptId: payload.workflowRunAttemptId,
        jobId: payload.jobId,
        jobExecutionId: JOB_EXECUTION_ID,
        originStepId: payload.stepId,
        originStepAttempt: payload.attempt,
        context: `failure:step:${payload.stepId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it('removes a stale step failure annotation after a successful terminal event', async () => {
    const payload = stepAttemptTerminatedPayload({attempt: 2, status: 'succeeded'});
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('does not resurrect a failure when an older failed event arrives after recovery', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 1,
      status: 'failed',
      exitCode: 1,
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const recoveredStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const recoveredAttempt = stepAttemptEntity({
      stepId: recoveredStep.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
      error: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: recoveredStep,
      attempt: recoveredAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('projects the canonical current attempt when an older failure event arrives late', async () => {
    const payload = stepAttemptTerminatedPayload();
    const oldStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'old step error'},
    });
    const oldAttempt = stepAttemptEntity({
      stepId: oldStep.id,
      attempt: 1,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const currentStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'current step error'},
    });
    const currentAttempt = stepAttemptEntity({
      stepId: currentStep.id,
      attempt: 2,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'current failure'},
      exitCode: 2,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: oldStep,
      attempt: oldAttempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: currentStep,
      attempt: currentAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepAttempt: 2,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('current failure'),
        }),
      }),
    );
  });

  it('skips first successful attempts without reading projection history', async () => {
    const payload = stepAttemptTerminatedPayload({status: 'succeeded'});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getStepAttemptDetail).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('projects a job failure from the current execution origin', async () => {
    const payload = jobTerminatedPayload({
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage:
        'Job output "payload" exceeds the per-value size limit of 16384 bytes (measured 16385 bytes; overshoot 1 bytes).',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'failed',
      stepAttempt: 2,
      stepError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptStatus: 'failed',
      attemptError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptExitCode: 1,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).toHaveBeenCalledWith(payload.jobExecutionId);
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: payload.jobExecutionId,
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 2,
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('Run tests'),
        }),
      }),
    );
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: expect.stringContaining('measured 16385 bytes; overshoot 1 bytes'),
        }),
      }),
    );
  });

  it('projects a condition evaluation error from a skipped job', async () => {
    const payload = jobTerminatedPayload({status: 'skipped', statusReason: 'condition_errored'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'skipped',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it('uses the first step as the origin when a job fails before any attempt starts', async () => {
    const payload = jobTerminatedPayload({status: 'failed'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Checkout',
      stepStatus: 'pending',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 1,
        annotation: expect.objectContaining({
          body: expect.stringContaining('before **Checkout** started'),
        }),
      }),
    );
  });

  it('does not guess an execution for legacy terminal events without an execution id', async () => {
    const payload = jobTerminatedPayload({jobExecutionId: undefined});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('does not project a duplicate job card for a step failure', async () => {
    const payload = jobTerminatedPayload({statusReason: 'step_failed'});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('skips successful jobs without reading projection history', async () => {
    const payload = jobTerminatedPayload({status: 'succeeded', statusReason: null});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('records and logs lookup failures without changing the terminal outcome', async () => {
    const error = new Error('database unavailable');
    dbMocks.getStepAttemptDetail.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(stepAttemptTerminatedPayload()),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('lookup');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'lookup'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('records and logs annotation write failures without throwing', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = new Error('annotation service unavailable');
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('write');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'write'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('classifies published annotation budget failures separately from write failures', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = createInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      'annotation-count-limit-exceeded',
      {maxAnnotations: 10},
    );
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('budget');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'budget'}),
      'Failed to project workflow failure annotation',
    );
  });
});

function stepAttemptTerminatedPayload(
  overrides: Partial<WorkflowsStepAttemptTerminatedEventDto> = {},
): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    workspaceId: '44444444-4444-4444-8444-444444444444',
    projectId: '55555555-5555-4555-8555-555555555555',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    status: 'failed',
    logOutcome: 'drained',
    ...overrides,
  };
}

function jobTerminatedPayload(
  overrides: Partial<WorkflowsJobTerminatedEventDto> = {},
): WorkflowsJobTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    jobExecutionId: JOB_EXECUTION_ID,
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    status: 'failed',
    statusReason: 'timed_out',
    ...overrides,
  };
}

function stepEntity(overrides: Partial<Step> = {}): Step {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    jobExecutionId: JOB_EXECUTION_ID,
    key: 'run',
    name: 'Run tests',
    sourceLocation: null,
    status: 'failed',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {run: 'pnpm test'},
    condition: null,
    configPlan: null,
    authoredConfig: {run: 'pnpm test'},
    error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    updatedAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

function stepAttemptEntity(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    executionOrder: 1,
    status: 'failed',
    config: {run: 'pnpm test'},
    evaluationTrace: null,
    output: null,
    response: null,
    error: null,
    exitCode: 1,
    gateResult: null,
    restartFeedback: null,
    logOutcome: 'drained',
    startedAt: new Date('2026-08-05T12:00:00.000Z'),
    finishedAt: new Date('2026-08-05T12:01:00.000Z'),
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}
