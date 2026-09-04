import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {
  WorkflowAdmissionDeniedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceSuspendedError,
} from './errors.js';

export interface WorkflowAdmissionInput {
  workspaceId: string;
  source: string;
  definitionId: string;
}

export interface RequiredAction {
  reason: string;
  message: string;
  url: string;
}

export type WorkflowAdmissionDecision =
  | {allowed: true}
  | {allowed: false; reason: string; requiredAction?: RequiredAction | undefined};

export interface WorkflowAdmissionPolicy {
  admit(input: WorkflowAdmissionInput): Promise<WorkflowAdmissionDecision>;
}

export interface WorkflowAdmissionCheck {
  policy?: WorkflowAdmissionPolicy | undefined;
  source: string;
  definitionId: string;
}

/** The host policy must not hold an admission path open indefinitely. */
export const WORKFLOW_ADMISSION_POLICY_TIMEOUT_MS = 5_000;

export async function assertWorkspaceAdmitsNewJobs(
  workspaces: Pick<WorkspacesInterModuleClient, 'getWorkspaceOperatingState'>,
  workspaceId: string,
  admission?: WorkflowAdmissionCheck | undefined,
): Promise<void> {
  let state: Awaited<ReturnType<WorkspacesInterModuleClient['getWorkspaceOperatingState']>>;
  try {
    state = await workspaces.getWorkspaceOperatingState({workspaceId});
  } catch (error) {
    if (
      isInterModuleKnownError(
        workspacesInterModuleContract.methods.getWorkspaceOperatingState,
        error,
      ) &&
      error.code === 'workspace-not-found'
    ) {
      throw new WorkspaceNotFoundError(error.details.workspaceId);
    }
    throw error;
  }

  const {status} = state;
  switch (status) {
    case 'active': {
      if (admission?.policy === undefined) return;

      const decision = await admitWithTimeout(admission.policy, {
        workspaceId,
        source: admission.source,
        definitionId: admission.definitionId,
      });
      if (!decision.allowed) {
        throw new WorkflowAdmissionDeniedError(
          workspaceId,
          decision.reason,
          decision.requiredAction,
        );
      }
      return;
    }
    case 'suspended':
      throw new WorkspaceSuspendedError(workspaceId);
    case 'deleted':
      throw new WorkspaceDeletedError(workspaceId);
    default:
      return assertNever(status);
  }
}

async function admitWithTimeout(
  policy: WorkflowAdmissionPolicy,
  input: WorkflowAdmissionInput,
): Promise<WorkflowAdmissionDecision> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      policy.admit(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Workflow admission policy timed out after ${WORKFLOW_ADMISSION_POLICY_TIMEOUT_MS}ms`,
            ),
          );
        }, WORKFLOW_ADMISSION_POLICY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workspace status: ${JSON.stringify(value)}`);
}
