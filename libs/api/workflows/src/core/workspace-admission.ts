import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {WorkspaceDeletedError, WorkspaceNotFoundError, WorkspaceSuspendedError} from './errors.js';

export async function assertWorkspaceAdmitsNewJobs(
  workspaces: Pick<WorkspacesInterModuleClient, 'getWorkspaceOperatingState'>,
  workspaceId: string,
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
    case 'active':
      return;
    case 'suspended':
      throw new WorkspaceSuspendedError(workspaceId);
    case 'deleted':
      throw new WorkspaceDeletedError(workspaceId);
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workspace status: ${JSON.stringify(value)}`);
}
