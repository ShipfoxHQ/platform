import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import {recordWorkflowCheckoutCapabilityWarningFailed} from '#metrics/instance.js';
import {annotationTargetFromLease} from './annotation-target.js';
import {getCheckoutPolicy} from './checkout.js';
import type {Step} from './entities/step.js';

type WarningFailureReason = 'budget' | 'lookup' | 'write';

export async function warnRenewableGitCapabilityMismatchOnDispatch(params: {
  annotations: AnnotationsInterModuleClient;
  runners: RunnersInterModuleClient;
  leaseIdentity: LeasedJobContext;
  step: Step;
}): Promise<void> {
  if (!isPersistedCheckout(params.step)) return;

  let capabilities: Awaited<
    ReturnType<RunnersInterModuleClient['getEffectiveRunnerToolCapabilities']>
  >;
  try {
    capabilities = await params.runners.getEffectiveRunnerToolCapabilities({
      runnerSessionId: params.leaseIdentity.runnerSessionId,
    });
  } catch (error) {
    recordWarningWriteFailure('lookup');
    logger().warn(
      {error, jobExecutionId: params.leaseIdentity.jobExecutionId, stepId: params.step.id},
      'Failed to read runner capabilities for renewable Git warning',
    );
    return;
  }

  // A stale report means the runner's current capability is unknown. Treating the empty fallback
  // as an explicit absence would replace a valid annotation during a heartbeat race.
  if (!capabilities.reportFresh) return;

  const context = `renewable-git-capability:${params.step.id}`;
  const renewableGitAdvertised = capabilities.capabilities.features?.renewable_git === true;
  const annotation = renewableGitAdvertised
    ? {op: 'remove' as const}
    : {
        op: 'replace' as const,
        style: 'warning' as const,
        body: [
          '**Renewable Git credentials are unavailable on this runner**',
          '',
          'This job persists Git credentials, but the matched runner did not advertise renewable Git support. Its checkout credential may expire during a long job.',
          'Upgrade the self-managed runner to a current Shipfox runner image to enable automatic renewal. The job continues with static checkout credentials for now.',
          '',
          'See the [Runner configuration reference](https://www.shipfox.io/docs/reference/runner) for the supported runner setup.',
        ].join('\n'),
      };

  try {
    await params.annotations.replaceOrRemoveAnnotation({
      ...annotationTargetFromLease(params.leaseIdentity),
      originStepId: params.step.id,
      originStepAttempt: params.step.currentAttempt,
      context,
      annotation,
    });
  } catch (error) {
    const reason = isAnnotationBudgetError(error) ? 'budget' : 'write';
    recordWarningWriteFailure(reason);
    logger().warn(
      {
        error,
        reason,
        jobExecutionId: params.leaseIdentity.jobExecutionId,
        stepId: params.step.id,
      },
      'Failed to write renewable Git capability warning annotation',
    );
  }
}

function isPersistedCheckout(step: Step): boolean {
  if (step.type !== 'setup' && step.type !== 'checkout') return false;
  return getCheckoutPolicy(step.config)?.persistCredentials === true;
}

function isAnnotationBudgetError(error: unknown): boolean {
  return isInterModuleKnownError(
    annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
    error,
  );
}

function recordWarningWriteFailure(reason: WarningFailureReason): void {
  recordWorkflowCheckoutCapabilityWarningFailed(reason);
}
