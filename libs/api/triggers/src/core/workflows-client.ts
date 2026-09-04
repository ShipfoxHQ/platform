import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {type InterModuleKnownErrorFor, isInterModuleKnownError} from '@shipfox/inter-module';
import type {TriggerDecisionDiagnostic} from './entities/diagnostic.js';

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

export function startRunDiagnostic(error: unknown): TriggerDecisionDiagnostic {
  return isPermanentStartRunError(error)
    ? knownStartDiagnostic(error)
    : {version: 1, code: 'unexpected-workflow-start-failure'};
}

export function startDevRunDiagnostic(error: unknown): TriggerDecisionDiagnostic {
  return isPermanentStartDevRunError(error)
    ? knownStartDiagnostic(error)
    : {version: 1, code: 'unexpected-workflow-start-failure'};
}

export function listenerDeliveryDiagnostic(error: unknown): TriggerDecisionDiagnostic {
  if (
    !isInterModuleKnownError(workflowsInterModuleContract.methods.deliverEventToJobListener, error)
  ) {
    return {version: 1, code: 'unexpected-listener-delivery-failure'};
  }
  return {version: 1, code: error.code};
}

function knownStartDiagnostic(
  error: StartRunKnownError | StartDevRunKnownError,
): TriggerDecisionDiagnostic {
  switch (error.code) {
    case 'admission-denied':
    case 'workspace-not-found':
    case 'workspace-suspended':
    case 'workspace-deleted':
    case 'definition-not-found':
    case 'project-mismatch':
    case 'agent-config-unresolvable':
    case 'agent-integration-materialization-failed':
      return {version: 1, code: error.code};
    case 'interpolation-unresolvable': {
      const envKey = error.details.envKey?.slice(0, 200);
      return {
        version: 1,
        code: error.code,
        field: error.details.field.slice(0, 200),
        ...(envKey ? {envKey} : {}),
      };
    }
    case 'invalid-job-runner-labels': {
      const labels = error.details.labels
        .map((label) => label.slice(0, 64))
        .filter((label) => label.length > 0)
        .slice(0, 10);
      if (labels.length === 0) {
        return {version: 1, code: 'unexpected-workflow-start-failure'};
      }
      return {
        version: 1,
        code: error.code,
        labels,
      };
    }
    case 'source-snapshot-too-large':
      return {
        version: 1,
        code: error.code,
        limitBytes: error.details.limitBytes,
        measuredBytes: error.details.measuredBytes,
      };
    case 'diagnostic-too-large':
      return {
        version: 1,
        code: error.code,
        field: error.details.field,
        limitBytes: error.details.limitBytes,
        measuredBytes: error.details.measuredBytes,
      };
    case 'workflow-execution-payload-too-large':
      return {
        version: 1,
        code: error.code,
        field: error.details.field,
        limitBytes: error.details.limitBytes,
        measuredBytes: error.details.measuredBytes,
        overshootBytes: error.details.overshootBytes,
      };
  }
}
