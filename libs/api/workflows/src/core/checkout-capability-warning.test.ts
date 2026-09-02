import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {JobLeaseTokenClaims} from '@shipfox/api-auth-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {warnRenewableGitCapabilityMismatchOnDispatch} from './checkout-capability-warning.js';
import type {Step} from './entities/step.js';

const annotation = vi.fn<AnnotationsInterModuleClient['replaceOrRemoveAnnotation']>();
const annotations: AnnotationsInterModuleClient = {
  replaceOrRemoveAnnotation: annotation,
  listAnnotationsForRunAttempt: vi.fn(),
};
const getEffectiveRunnerToolCapabilities =
  vi.fn<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>();
const runners = {
  getEffectiveRunnerToolCapabilities,
} as unknown as RunnersInterModuleClient;

beforeEach(() => {
  annotation.mockClear();
  annotation.mockResolvedValue({});
  getEffectiveRunnerToolCapabilities.mockClear();
  getEffectiveRunnerToolCapabilities.mockResolvedValue({
    capabilities: {harnesses: {}},
    reportFresh: true,
  });
});

describe('warnRenewableGitCapabilityMismatchOnDispatch', () => {
  it('warns when a persisted checkout runner does not advertise renewable Git', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});

    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step,
    });

    expect(annotation).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: leaseIdentity.jobExecutionId,
        originStepId: step.id,
        context: `renewable-git-capability:${step.id}`,
        annotation: expect.objectContaining({
          op: 'replace',
          style: 'warning',
          body: expect.stringContaining('may expire during a long job'),
        }),
      }),
    );
  });

  it('warns when a fresh runner report explicitly disables renewable Git', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});
    getEffectiveRunnerToolCapabilities.mockResolvedValue({
      capabilities: {features: {renewable_git: false}, harnesses: {}},
      reportFresh: true,
    });

    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step,
    });

    expect(annotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `renewable-git-capability:${step.id}`,
        annotation: expect.objectContaining({op: 'replace'}),
      }),
    );
  });

  it('removes an existing warning when the runner advertises renewable Git', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});
    getEffectiveRunnerToolCapabilities.mockResolvedValue({
      capabilities: {features: {renewable_git: true}, harnesses: {}},
      reportFresh: true,
    });

    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step,
    });

    expect(annotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `renewable-git-capability:${step.id}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('does not inspect capabilities for non-persisted or non-checkout steps', async () => {
    const leaseIdentity = lease();

    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step: checkoutStep({
        jobExecutionId: leaseIdentity.jobExecutionId,
        config: {checkout: {persist_credentials: false}},
      }),
    });
    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step: checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId, type: 'run'}),
    });

    expect(getEffectiveRunnerToolCapabilities).not.toHaveBeenCalled();
    expect(annotation).not.toHaveBeenCalled();
  });

  it('does not make a capability lookup failure affect dispatch', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});
    getEffectiveRunnerToolCapabilities.mockRejectedValue(new Error('runner lookup failed'));

    await expect(
      warnRenewableGitCapabilityMismatchOnDispatch({
        annotations,
        runners,
        leaseIdentity,
        step,
      }),
    ).resolves.toBeUndefined();

    expect(annotation).not.toHaveBeenCalled();
  });

  it('does not make an annotation write failure affect dispatch', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});
    annotation.mockRejectedValueOnce(new Error('annotation write failed'));

    await expect(
      warnRenewableGitCapabilityMismatchOnDispatch({
        annotations,
        runners,
        leaseIdentity,
        step,
      }),
    ).resolves.toBeUndefined();

    expect(annotation).toHaveBeenCalledOnce();
  });

  it('does not project a warning from a stale capability report', async () => {
    const leaseIdentity = lease();
    const step = checkoutStep({jobExecutionId: leaseIdentity.jobExecutionId});
    getEffectiveRunnerToolCapabilities.mockResolvedValue({
      capabilities: {features: {renewable_git: true}, harnesses: {}},
      reportFresh: false,
    });

    await warnRenewableGitCapabilityMismatchOnDispatch({
      annotations,
      runners,
      leaseIdentity,
      step,
    });

    expect(annotation).not.toHaveBeenCalled();
  });
});

function lease(): JobLeaseTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: 'runner-job-lease',
    iat: now,
    exp: now + 60,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttempt: 1,
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
    currentStepId: crypto.randomUUID(),
    currentStepAttempt: 1,
  };
}

function checkoutStep(params: Partial<Step> = {}): Step {
  return {
    id: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    key: 'checkout',
    name: 'Checkout',
    sourceLocation: null,
    status: 'running',
    statusReason: null,
    evaluationTrace: null,
    type: 'checkout',
    config: {
      checkout: {
        repository: 'acme/repository',
        persist_credentials: true,
      },
    },
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...params,
  };
}
