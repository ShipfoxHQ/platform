import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {type InterModuleKnownErrorFor, isInterModuleKnownError} from '@shipfox/inter-module';

export type {WorkflowsModuleClient};

type StartRunKnownError = InterModuleKnownErrorFor<
  typeof workflowsInterModuleContract.methods.startRunFromTrigger
>;
type StartDevRunKnownError = InterModuleKnownErrorFor<
  typeof workflowsInterModuleContract.methods.startDevRun
>;

/**
 * Workflows declares only failures that can never succeed on retry for trigger
 * run creation, including workspace admission failures. Every other outcome is
 * opaque and must remain retryable because it may have committed before the
 * caller stopped waiting.
 */
export function isPermanentStartRunError(error: unknown): error is StartRunKnownError {
  return isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error);
}

/** Same guarantee for dev-run creation through `startDevRun`. */
export function isPermanentStartDevRunError(error: unknown): error is StartDevRunKnownError {
  return isInterModuleKnownError(workflowsInterModuleContract.methods.startDevRun, error);
}

/** Known listener admission failures cannot succeed by replaying the same event. */
export function isPermanentDeliverEventToJobListenerError(error: unknown): boolean {
  return isInterModuleKnownError(
    workflowsInterModuleContract.methods.deliverEventToJobListener,
    error,
  );
}
