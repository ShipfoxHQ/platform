import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {
  type WorkflowAdmissionDeniedError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceSuspendedError,
} from './errors.js';
import {
  assertWorkspaceAdmitsNewJobs,
  WORKFLOW_ADMISSION_POLICY_TIMEOUT_MS,
} from './workspace-admission.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

describe('assertWorkspaceAdmitsNewJobs', () => {
  test('allows active workspaces', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});

    await assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
  });

  test('passes the workflow context to an admission policy', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});
    const admit = vi.fn().mockResolvedValue({allowed: true});

    await assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId, {
      policy: {admit},
      source: 'manual',
      definitionId: 'definition-1',
    });

    expect(admit).toHaveBeenCalledWith({
      workspaceId,
      source: 'manual',
      definitionId: 'definition-1',
    });
  });

  test('rejects an explicit policy denial with its required action', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});
    const requiredAction = {
      reason: 'billing-payment-method-required',
      message: 'Add a payment method to continue.',
      url: '/settings/billing',
    };
    const admit = vi.fn().mockResolvedValue({
      allowed: false,
      reason: requiredAction.reason,
      requiredAction,
    });

    await expect(
      assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId, {
        policy: {admit},
        source: 'github',
        definitionId: 'definition-1',
      }),
    ).rejects.toMatchObject({
      name: 'WorkflowAdmissionDeniedError',
      workspaceId,
      reason: requiredAction.reason,
      requiredAction,
    } satisfies Partial<WorkflowAdmissionDeniedError>);
  });

  test('runs the operating-state gate before the policy', async () => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'suspended'});
    const admit = vi.fn().mockResolvedValue({allowed: false, reason: 'policy-denied'});

    await expect(
      assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId, {
        policy: {admit},
        source: 'manual',
        definitionId: 'definition-1',
      }),
    ).rejects.toBeInstanceOf(WorkspaceSuspendedError);
    expect(admit).not.toHaveBeenCalled();
  });

  test('treats a hanging policy as a transient timeout', async () => {
    vi.useFakeTimers();
    try {
      const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});
      const admit = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
      const check = assertWorkspaceAdmitsNewJobs({getWorkspaceOperatingState}, workspaceId, {
        policy: {admit},
        source: 'manual',
        definitionId: 'definition-1',
      });
      const rejection = expect(check).rejects.toThrow('Workflow admission policy timed out');

      await vi.advanceTimersByTimeAsync(WORKFLOW_ADMISSION_POLICY_TIMEOUT_MS);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
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
