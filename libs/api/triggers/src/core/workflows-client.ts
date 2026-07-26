import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';

export type {WorkflowsModuleClient};

type StartRunKnownError = NonNullable<ReturnType<typeof startRunKnownError>>;

/**
 * Workflows declares only failures that can never succeed on retry for trigger
 * run creation, including workspace admission failures. Every other outcome is
 * opaque and must remain retryable because it may have committed before the
 * caller stopped waiting.
 */
export function isPermanentStartRunError(error: unknown): error is StartRunKnownError {
  return isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error);
}

/** Known listener admission failures cannot succeed by replaying the same event. */
export function isPermanentDeliverEventToJobListenerError(error: unknown): boolean {
  return isInterModuleKnownError(
    workflowsInterModuleContract.methods.deliverEventToJobListener,
    error,
  );
}

export function isWorkspaceSuspendedError(
  error: unknown,
): error is Extract<StartRunKnownError, {code: 'workspace-suspended'}> {
  return isPermanentStartRunError(error) && error.code === 'workspace-suspended';
}

export function isWorkspaceNotFoundError(
  error: unknown,
): error is Extract<StartRunKnownError, {code: 'workspace-not-found'}> {
  return isPermanentStartRunError(error) && error.code === 'workspace-not-found';
}

export function isWorkspaceDeletedError(
  error: unknown,
): error is Extract<StartRunKnownError, {code: 'workspace-deleted'}> {
  return isPermanentStartRunError(error) && error.code === 'workspace-deleted';
}

export function isInterpolationUnresolvableError(
  error: unknown,
): error is Extract<ReturnType<typeof startRunKnownError>, {code: 'interpolation-unresolvable'}> {
  return (
    isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
    error.code === 'interpolation-unresolvable'
  );
}

function startRunKnownError(error: unknown) {
  if (!isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error)) {
    return undefined;
  }
  return error;
}
