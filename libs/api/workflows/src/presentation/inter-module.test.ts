import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import {InvalidJobRunnerLabelsError} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
} from '#core/index.js';
import {createWorkflowsInterModulePresentation, toStartRunKnownError} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  deliverEventToListener: vi.fn(),
  getJobScope: vi.fn(),
  getStepById: vi.fn(),
  getStepByIdForJobExecution: vi.fn(),
}));

vi.mock('#db/index.js', () => mocks);
vi.mock('#db/job-listener-events.js', () => ({
  deliverEventToListener: mocks.deliverEventToListener,
}));

const input = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  definitionId: '00000000-0000-4000-8000-000000000003',
  triggerPayload: {
    provider: 'manual' as const,
    source: 'manual' as const,
    event: 'fire' as const,
    subscriptionId: '00000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000005',
  },
  idempotencyKey: 'manual-1',
};

describe('Workflows inter-module presentation', () => {
  beforeEach(() => {
    mocks.getJobScope.mockReset();
    mocks.getStepById.mockReset();
    mocks.getStepByIdForJobExecution.mockReset();
    mocks.deliverEventToListener.mockReset();
    mocks.deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
  });

  it('returns only the resolved harness for Logs', async () => {
    mocks.getStepById.mockResolvedValue({config: {harness: 'claude'}});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    const result = await presentation.handlers.getStepLogContext(
      {stepId: '00000000-0000-4000-8000-000000000006'},
      {signal: new AbortController().signal},
    );

    expect(result).toEqual({harness: 'claude'});
  });

  it('returns materialized agent integrations for the active leased step', async () => {
    const input = {
      jobId: '00000000-0000-4000-8000-000000000006',
      jobExecutionId: '00000000-0000-4000-8000-000000000007',
      runnerSessionId: '00000000-0000-4000-8000-000000000008',
      stepId: '00000000-0000-4000-8000-000000000009',
      attempt: 1,
    };
    const integration = {
      connectionId: 'connection-1',
      connectionSlug: 'github',
      provider: 'github',
      requiredScope: [],
      tools: [
        {
          id: 'files',
          sensitivity: 'read' as const,
          sensitive: false,
          requiredScope: [],
          inputSchema: {},
        },
      ],
    };
    mocks.getStepByIdForJobExecution.mockResolvedValue({
      currentAttempt: input.attempt,
      status: 'running',
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5',
        thinking: 'off',
        prompt: 'Review the change.',
        integrations: [integration],
      },
    });
    mocks.getJobScope.mockResolvedValue({workspaceId: '00000000-0000-4000-8000-000000000010'});
    const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: runners as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    const result = await presentation.handlers.getLeasedAgentToolContext(input, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000010',
      integrations: [integration],
    });
    expect(runners.getLeaseState).toHaveBeenCalledWith({
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      runnerSessionId: input.runnerSessionId,
    });
  });

  test.each([
    ['definition-not-found', () => new DefinitionNotFoundError(input.definitionId)],
    ['project-mismatch', () => new ProjectMismatchError(input.projectId, input.definitionId)],
    ['agent-config-unresolvable', () => new AgentConfigUnresolvableError(input.definitionId)],
    [
      'agent-integration-materialization-failed',
      () => new AgentIntegrationMaterializationError('integration unavailable'),
    ],
    [
      'interpolation-unresolvable',
      () =>
        new InterpolationUnresolvableError(input.definitionId, {
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        }),
    ],
    ['invalid-job-runner-labels', () => new InvalidJobRunnerLabelsError(['gpu'])],
  ] as const)('maps %s to the published contract error', (code, error) => {
    const result = toStartRunKnownError(error(), input.definitionId);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, result) &&
        result.code,
    ).toBe(code);
  });

  test('maps a missing workspace from the Workspace contract for start-run', async () => {
    const getWorkspaceOperatingState = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          workspacesInterModuleContract.methods.getWorkspaceOperatingState,
          'workspace-not-found',
          {workspaceId: input.workspaceId},
        ),
      );
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.startRunFromTrigger(input, {
        signal: new AbortController().signal,
      }),
    ).catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
        error.code,
    ).toBe('workspace-not-found');
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects new workflow runs for %s workspaces before loading the definition', async (status, code) => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.startRunFromTrigger(input, {
        signal: new AbortController().signal,
      }),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId: input.workspaceId});
    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
        error.code,
    ).toBe(code);
  });

  test('maps a missing workspace from the Workspace contract for listener delivery', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          workspacesInterModuleContract.methods.getWorkspaceOperatingState,
          'workspace-not-found',
          {workspaceId},
        ),
      );
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'fire',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(
        workflowsInterModuleContract.methods.deliverEventToJobListener,
        error,
      ) && error.code,
    ).toBe('workspace-not-found');
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects listener execution materialization for %s workspaces', async (status, code) => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'fire',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
    expect(mocks.deliverEventToListener).not.toHaveBeenCalled();
    expect(
      isInterModuleKnownError(
        workflowsInterModuleContract.methods.deliverEventToJobListener,
        error,
      ) && error.code,
    ).toBe(code);
  });

  test('allows resolve deliveries for suspended workspaces', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    mocks.getJobScope.mockResolvedValue({workspaceId: input.workspaceId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'suspended'});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    await expect(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'resolve',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({buffered: true, skipped: false});
    expect(mocks.getJobScope).not.toHaveBeenCalled();
    expect(getWorkspaceOperatingState).not.toHaveBeenCalled();
    expect(mocks.deliverEventToListener).toHaveBeenCalled();
  });

  test('persists a null trigger reference when fire delivery has no source connection', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {
        getWorkspaceOperatingState: vi.fn().mockResolvedValue({status: 'active'}),
      } as never,
    });

    await presentation.handlers.deliverEventToJobListener(
      {
        jobId,
        disposition: 'fire',
        eventRef: 'event-1',
        deliveryId: 'delivery-1',
        source: 'github',
        event: 'push',
        provider: 'github',
        payload: {},
        receivedAt: '2026-07-20T12:00:00.000Z',
      },
      {signal: new AbortController().signal},
    );

    expect(mocks.deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({triggerReference: null}),
    );
  });

  test('resolves and persists the trigger reference for fire deliveries', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    const connectionId = '00000000-0000-4000-8000-000000000008';
    const projectId = '00000000-0000-4000-8000-000000000009';
    const externalRepositoryId = 'github:42';
    const integrations = {
      resolveTriggerReference: vi.fn().mockResolvedValue({
        externalRepositoryId,
        ref: 'refs/heads/main',
        commit: 'a'.repeat(40),
      }),
      resolveSourceRepository: vi.fn().mockResolvedValue({
        repository: {owner: 'acme', name: 'api'},
      }),
    };
    const projects = {
      getProjectBySource: vi.fn().mockResolvedValue({project: {id: projectId}}),
    };
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: integrations as never,
      projects: projects as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    await presentation.handlers.deliverEventToJobListener(
      {
        jobId,
        disposition: 'fire',
        eventRef: 'event-1',
        deliveryId: 'delivery-1',
        source: 'github',
        event: 'push',
        provider: 'github',
        triggerConnectionId: connectionId,
        payload: {ref: 'refs/heads/main'},
        receivedAt: '2026-07-20T12:00:00.000Z',
      },
      {signal: new AbortController().signal},
    );

    expect(integrations.resolveTriggerReference).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      payload: {ref: 'refs/heads/main'},
    });
    expect(projects.getProjectBySource).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    expect(mocks.deliverEventToListener).toHaveBeenCalledWith({
      jobId,
      disposition: 'fire',
      eventRef: 'event-1',
      deliveryId: 'delivery-1',
      source: 'github',
      event: 'push',
      provider: 'github',
      triggerConnectionId: connectionId,
      payload: {ref: 'refs/heads/main'},
      receivedAt: new Date('2026-07-20T12:00:00.000Z'),
      triggerReference: {
        project: {id: projectId},
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: 'a'.repeat(40),
      },
    });
  });
});
