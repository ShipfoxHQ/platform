import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {WorkspaceDeletedError, WorkspaceNotFoundError, WorkspaceSuspendedError} from './errors.js';
import {assertWorkspaceAdmitsNewJobs} from './workspace-admission.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('assertWorkspaceAdmitsNewJobs', () => {
  test('allows active workspaces', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});

    await assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
  });

  test.each([
    ['suspended', WorkspaceSuspendedError],
    ['deleted', WorkspaceDeletedError],
  ] as const)('rejects %s workspaces', async (status, errorType) => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});

    await expect(
      assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId),
    ).rejects.toBeInstanceOf(errorType);
  });

  test('translates a missing workspace from the Workspaces contract', async () => {
    const error = createInterModuleKnownError(
      workspacesInterModuleContract.methods.getWorkspaceOperatingState,
      'workspace-not-found',
      {workspaceId},
    );
    const getWorkspaceOperatingState = vi.fn().mockRejectedValue(error);

    const caught = await assertWorkspaceAdmitsNewJobs(
      {getWorkspaceOperatingState},
      workspaceId,
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(WorkspaceNotFoundError);
    expect(caught).toMatchObject({
      workspaceId,
      name: 'WorkspaceNotFoundError',
    });
  });

  test('rethrows transient Workspaces failures', async () => {
    const error = new Error('workspace service unavailable');
    const getWorkspaceOperatingState = vi.fn().mockRejectedValue(error);

    await expect(
      assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId),
    ).rejects.toBe(error);
  });

  test('fails closed for an unknown workspace status', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'unknown'});

    await expect(
      assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId),
    ).rejects.toThrow('Unhandled workspace status');
  });
});
