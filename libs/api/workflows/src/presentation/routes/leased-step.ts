import {type LeasedJobContext, requireLeasedJobContext} from '@shipfox/api-auth-context';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {CheckoutRenewalSubject} from '#core/entities/checkout-renewal-subject.js';
import type {Step} from '#core/entities/step.js';
import type {
  WorkflowRunOriginState,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import {loadCheckoutRenewalSubject} from '#db/checkout-renewal-subjects.js';
import {getJobScope, getStepByIdForJobExecution} from '#db/index.js';

export interface LoadedRunningLeasedStep {
  leasedJob: LeasedJobContext;
  step: Step;
  workspaceId: string;
  projectId: string;
  triggerReference: WorkflowRunTriggerReference | null;
  /** The run's origin state, forwarded for checkout fallbacks. */
  run: WorkflowRunOriginState;
  /** The server-frozen subject for a successful persisted checkout renewal. */
  checkoutRenewalSubject?: CheckoutRenewalSubject;
  /** The capability snapshot captured when the runner claimed this execution. */
  renewableInference?: boolean;
}

export async function assertLeasedJobActive(
  runners: RunnersInterModuleClient,
  leasedJob: Pick<LeasedJobContext, 'jobId' | 'jobExecutionId' | 'runnerSessionId'>,
): Promise<Awaited<ReturnType<RunnersInterModuleClient['getLeaseState']>>> {
  const leaseState = await runners.getLeaseState({
    jobId: leasedJob.jobId,
    jobExecutionId: leasedJob.jobExecutionId,
    runnerSessionId: leasedJob.runnerSessionId,
  });
  if (!leaseState.active) {
    throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
  }
  return leaseState;
}

export async function loadRunningLeasedStep(params: {
  runners: RunnersInterModuleClient;
  request: object;
  stepId: string;
  attempt: number;
  allowSuccessfulPersistedCheckout?: boolean;
}): Promise<LoadedRunningLeasedStep> {
  const leasedJob = requireLeasedJobContext(params.request);

  const leaseState = await assertLeasedJobActive(params.runners, leasedJob);
  const renewableInference =
    leaseState.renewableInference === undefined
      ? {}
      : {renewableInference: leaseState.renewableInference};

  const step = await getStepByIdForJobExecution({
    stepId: params.stepId,
    jobExecutionId: leasedJob.jobExecutionId,
  });
  if (!step) {
    throw new ClientError('Step not found for leased job', 'step-not-found', {status: 404});
  }

  const scope = await getJobScope(leasedJob.jobId);
  if (!scope) {
    throw new ClientError('Leased job not found', 'job-not-found', {status: 404});
  }

  if (step.currentAttempt !== params.attempt) {
    throw new ClientError('Step attempt does not match current attempt', 'step-attempt-mismatch', {
      status: 409,
    });
  }

  if (step.status !== 'running') {
    if (step.status === 'succeeded' && params.allowSuccessfulPersistedCheckout) {
      const checkoutRenewalSubject = await loadCheckoutRenewalSubject(step.id);
      if (checkoutRenewalSubject !== null) {
        return {
          leasedJob,
          step,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          triggerReference: scope.triggerReference,
          run: scope.run,
          checkoutRenewalSubject,
          ...renewableInference,
        };
      }
    }
    throw new ClientError('Step is not running', 'step-not-running', {status: 409});
  }

  return {
    leasedJob,
    step,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    triggerReference: scope.triggerReference,
    run: scope.run,
    ...renewableInference,
  };
}
