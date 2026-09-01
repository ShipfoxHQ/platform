import type {reportError as reportErrorType} from '@shipfox/node-error-monitoring';
import type {logger as loggerFactoryType} from '@shipfox/node-opentelemetry';
import {
  type AgentToolsProviderOptions,
  catalogTool,
  catalogWithRepositoryScope,
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {IntegrationProviderError} from './errors.js';
import type {AgentToolRepositoryScopeClassifier} from './providers/agent-tools.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';
import {
  type RepositoryAuthorizationResult,
  RepositoryAuthorizationTargetInvalidError,
  type RepositoryAuthorizer,
  type ResolveRepositoryAuthorizationInput,
} from './repository-authorizer.js';
import {
  callIntegrationTool,
  type IntegrationToolCallInput,
  loadAuthorizedToolConnection,
} from './tool-call-service.js';

const serviceMocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  reportError: vi.fn(),
}));

const loggerFactory = (() => ({
  error: serviceMocks.loggerError,
})) as unknown as typeof loggerFactoryType;
const reportError = serviceMocks.reportError as unknown as typeof reportErrorType;

describe('callIntegrationTool', () => {
  beforeEach(() => {
    serviceMocks.loggerError.mockReset();
    serviceMocks.reportError.mockReset();
  });

  it('opens, calls, and closes a provider session with the materialized tool catalog entry', async () => {
    const onOpenSession = vi.fn();
    const onClose = vi.fn();
    const input = createInput({onOpenSession, onClose});

    const result = await callIntegrationTool(input);

    expect(result).toEqual({
      outcome: 'success',
      result: {
        content: [{type: 'text', text: 'dispatched'}],
        structuredContent: {
          status: 'dispatched',
          provider: 'github',
          connection_id: 'connection-1',
          tool_id: 'issue_read',
          method: 'get',
        },
      },
    });
    expect(onOpenSession).toHaveBeenCalledWith({
      connection: input.connection,
      tools: [
        expect.objectContaining({
          id: 'issue_read',
          description: 'Read issue metadata from GitHub.',
          inputSchema: input.inputSchema,
          methods: [
            expect.objectContaining({id: 'get', description: 'Get one issue.'}),
            expect.objectContaining({id: 'get_comments', description: 'Get issue comments.'}),
          ],
        }),
      ],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('denies a declared repository before opening a provider session', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const resolveRepositoryAuthorization = vi.fn(
      async (): Promise<RepositoryAuthorizationResult> => ({
        authorized: false,
        reason: 'repository_not_granted',
      }),
    );
    const repositoryAuthorizer: RepositoryAuthorizer = {
      enabled: true,
      resolveRepositoryAuthorization,
    };
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput({onOpenSession}, {registry, catalogEntry: entry, repositoryAuthorizer}),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {
        code: 'repository-not-granted',
        message: 'Repository is not authorized for this integration connection',
      },
      authorization: {
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'declared-targets',
        repositoryAccess: 'selected',
        decision: 'denied',
        denialReason: 'repository_not_granted',
        targetProjectIds: [],
      },
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        connectionId: 'connection-1',
        mode: 'selected',
        repository: {kind: 'name', owner: 'shipfox', name: 'platform'},
        capability: 'tools',
        request: expect.any(Object),
      }),
    );
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('re-reads the current catalog before classifying an authorized call', async () => {
    const staleEntry = catalogTool({
      methods: undefined,
      repositoryScope: () => ({kind: 'connection'}),
    });
    const liveEntry = catalogTool({
      methods: undefined,
      repositoryScope: declaredRepositoryScope,
    });
    const onOpenSession = vi.fn();
    const resolveRepositoryAuthorization = vi.fn(
      async (): Promise<RepositoryAuthorizationResult> => ({
        authorized: false,
        reason: 'repository_not_granted',
      }),
    );
    const registry = registryWithAgentTools([liveEntry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });
    const catalog = vi.spyOn(registry.getAdapter('github', 'agent_tools'), 'catalog');

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: staleEntry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {code: 'repository-not-granted'},
      authorization: {
        classification: 'declared-targets',
        decision: 'denied',
        denialReason: 'repository_not_granted',
      },
    });
    expect(catalog).toHaveBeenCalledOnce();
    expect(resolveRepositoryAuthorization).toHaveBeenCalledOnce();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('does not inherit an entry classifier for a method without its own classifier', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogTool({repositoryScope: declaredRepositoryScope});
    const resolveRepositoryAuthorization = vi.fn();
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {
        code: 'provider-rejected',
        message: 'Enforced integration tool is missing a repository scope classifier',
      },
    });
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('authorizes every declared target and denies the whole multi-target call', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(() => ({
      kind: 'declared-targets',
      repositories: [
        {owner: 'shipfox', name: 'platform'},
        {owner: 'shipfox', name: 'private'},
      ],
    }));
    const resolveRepositoryAuthorization = vi.fn(
      async ({
        repository,
      }: ResolveRepositoryAuthorizationInput): Promise<RepositoryAuthorizationResult> =>
        repository.kind === 'name' && repository.name === 'private'
          ? {authorized: false, reason: 'repository_not_granted'}
          : {
              authorized: true,
              repository: {owner: 'shipfox', name: 'platform'},
              targetProjectId: 'project-platform',
            },
    );
    const repositoryAuthorizer: RepositoryAuthorizer = {
      enabled: true,
      resolveRepositoryAuthorization,
    };
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput({onOpenSession}, {registry, catalogEntry: entry, repositoryAuthorizer}),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {code: 'repository-not-granted'},
      authorization: {
        decision: 'denied',
        denialReason: 'repository_not_granted',
        targetProjectIds: ['project-platform'],
      },
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledTimes(2);
    expect(resolveRepositoryAuthorization.mock.calls.map(([input]) => input.repository)).toEqual([
      {kind: 'name', owner: 'shipfox', name: 'platform'},
      {kind: 'name', owner: 'shipfox', name: 'private'},
    ]);
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('maps an invalid declared target to a bounded repository denial', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogTool({
      methods: undefined,
      repositoryScope: () => ({
        kind: 'declared-targets',
        repositories: [{owner: 'octo/hello', name: 'platform'}],
      }),
    });
    const resolveRepositoryAuthorization = vi.fn(() =>
      Promise.reject(new RepositoryAuthorizationTargetInvalidError()),
    );
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {
        code: 'repository-not-granted',
        message: 'Repository is not authorized for this integration connection',
      },
      authorization: {
        decision: 'denied',
        denialReason: 'repository_not_granted',
        repositories: [{owner: 'octo/hello', name: 'platform'}],
      },
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledOnce();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('denies an enforced empty declared-targets scope without opening a session', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogTool({
      methods: undefined,
      repositoryScope: () => ({kind: 'declared-targets', repositories: []}),
    });
    const resolveRepositoryAuthorization = vi.fn();
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {code: 'repository-not-granted'},
      authorization: {
        decision: 'denied',
        denialReason: 'repository_not_granted',
        repositories: [],
      },
    });
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('maps an unavailable authorization store to a bounded denial', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const resolveRepositoryAuthorization = vi.fn(async (): Promise<undefined> => undefined);
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {
        code: 'repository-authorization-unavailable',
        message: 'Repository authorization is temporarily unavailable',
      },
      authorization: {
        decision: 'denied',
        denialReason: 'authorization_store_unavailable',
      },
    });
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('maps an ambiguous authorization result to a bounded denial', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const resolveRepositoryAuthorization = vi.fn(
      async (): Promise<RepositoryAuthorizationResult> => ({
        authorized: false,
        reason: 'repository_ambiguous',
      }),
    );
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'error',
      error: {
        code: 'repository-ambiguous',
        message: 'Repository authorization is ambiguous for this integration connection',
      },
      authorization: {
        decision: 'denied',
        denialReason: 'repository_ambiguous',
      },
    });
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('keeps connection-scoped calls available and records their classification', async () => {
    const onOpenSession = vi.fn();
    const baseEntry = catalogTool();
    const entry = catalogTool({
      repositoryScope: declaredRepositoryScope,
      methods: baseEntry.methods?.map((method) => ({
        ...method,
        repositoryScope: () => ({kind: 'connection'}),
      })),
      indirectTargetNote: 'Provider resolves the destination from the connection.',
    });
    const resolveRepositoryAuthorization = vi.fn();
    const repositoryAuthorizer: RepositoryAuthorizer = {
      enabled: true,
      resolveRepositoryAuthorization,
    };
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput({onOpenSession}, {registry, catalogEntry: entry, repositoryAuthorizer}),
    );

    expect(result).toMatchObject({
      outcome: 'success',
      authorization: {
        repositories: [],
        classification: 'connection',
        repositoryAccess: 'selected',
        decision: 'not-applicable',
        denialReason: 'none',
        targetProjectIds: [],
        indirectTargetNote: 'Provider resolves the destination from the connection.',
      },
    });
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).toHaveBeenCalledTimes(1);
  });

  it('keeps provider-unclassified calls available while recording declared targets', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const resolveRepositoryAuthorization = vi.fn();
    const repositoryAuthorizer: RepositoryAuthorizer = {
      enabled: true,
      resolveRepositoryAuthorization,
    };
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'unclassified',
      onOpenSession,
    });

    const result = await callIntegrationTool(
      createInput({onOpenSession}, {registry, catalogEntry: entry, repositoryAuthorizer}),
    );

    expect(result).toMatchObject({
      outcome: 'success',
      authorization: {
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'unclassified',
        repositoryAccess: 'selected',
        decision: 'not-applicable',
        denialReason: 'none',
      },
    });
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).toHaveBeenCalledTimes(1);
  });

  it('does not refetch the catalog when repository authorization is disabled', async () => {
    const onOpenSession = vi.fn();
    const registry = registryWithAgentTools([catalogTool()], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });
    const catalog = vi.spyOn(registry.getAdapter('github', 'agent_tools'), 'catalog');
    const resolveRepositoryAuthorization = vi.fn();

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          repositoryAuthorizer: {enabled: false, resolveRepositoryAuthorization},
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'success',
      authorization: {
        classification: 'connection',
        decision: 'not-enforced',
        denialReason: 'none',
      },
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).toHaveBeenCalledOnce();
  });

  it('passes the explicit all repository mode to each authorization target', async () => {
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const resolveRepositoryAuthorization = vi.fn(
      async (): Promise<RepositoryAuthorizationResult> => ({
        authorized: true,
        repository: {owner: 'shipfox', name: 'platform'},
        targetProjectId: 'project-platform',
      }),
    );
    const repositoryAuthorizer: RepositoryAuthorizer = {
      enabled: true,
      resolveRepositoryAuthorization,
    };
    const registry = registryWithAgentTools([entry], {repositoryAuthorization: 'enforced'});

    const result = await callIntegrationTool(
      createInput(
        {},
        {
          registry,
          catalogEntry: entry,
          repositoryAccessMode: 'all',
          repositoryAuthorizer,
        },
      ),
    );

    expect(result).toMatchObject({
      outcome: 'success',
      authorization: {
        repositoryAccess: 'all',
        decision: 'allowed',
        targetProjectIds: ['project-platform'],
      },
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({mode: 'all'}),
    );
  });

  it.each([
    [
      'provider errors preserve retry and status details',
      new IntegrationProviderError('rate-limited', 'Try again later', 30, 429),
      {
        code: 'rate-limited',
        message: 'Try again later',
        retryAfterSeconds: 30,
        status: 429,
      },
    ],
    [
      'credential failures map to credentials-unavailable',
      Object.assign(new Error('missing token'), {name: 'CredentialError'}),
      {
        code: 'credentials-unavailable',
        message: 'Integration provider credentials are unavailable',
      },
    ],
  ])('%s', async (_caseName, callError, expectedError) => {
    const result = await callIntegrationTool(createInput({callError}));

    expect(result).toEqual({outcome: 'error', error: expectedError});
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
    expect(serviceMocks.reportError).not.toHaveBeenCalled();
  });

  it('reports provider timeouts at error level with bounded log context', async () => {
    const timeoutError = Object.assign(new Error('request timed out'), {name: 'TimeoutError'});

    const result = await callIntegrationTool(createInput({callError: timeoutError}));

    expect(result).toEqual({
      outcome: 'error',
      error: {code: 'provider-timeout', message: 'Integration provider timed out'},
    });
    expect(serviceMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({err: timeoutError, errorCode: 'provider-timeout'}),
      'Integration agent tool provider timed out',
    );
    expect(serviceMocks.reportError).toHaveBeenCalledWith(timeoutError, {
      boundary: 'integration.agent-tool',
    });
  });

  it('reports provider outages and unknown failures with bounded log context', async () => {
    const providerError = new IntegrationProviderError(
      'provider-unavailable',
      'GitHub returned HTTP 503',
      undefined,
      503,
    );

    const providerResult = await callIntegrationTool(createInput({callError: providerError}));

    expect(providerResult).toEqual({
      outcome: 'error',
      error: {code: 'provider-unavailable', message: 'GitHub returned HTTP 503', status: 503},
    });
    expect(serviceMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: providerError,
        provider: 'github',
        toolId: 'issue_read',
        method: 'get',
        errorCode: 'provider-unavailable',
        providerStatus: 503,
      }),
      'Integration agent tool provider was unavailable',
    );
    expect(serviceMocks.reportError).toHaveBeenCalledWith(providerError, {
      boundary: 'integration.agent-tool',
    });

    serviceMocks.loggerError.mockReset();
    serviceMocks.reportError.mockReset();
    const unknownError = new Error('internal failure');
    const unknownResult = await callIntegrationTool(createInput({callError: unknownError}));

    expect(unknownResult).toEqual({
      outcome: 'error',
      error: {code: 'unknown', message: 'Integration tool call failed'},
    });
    expect(serviceMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({err: unknownError, errorCode: 'unknown'}),
      'Integration agent tool call failed',
    );
    expect(serviceMocks.reportError).toHaveBeenCalledWith(unknownError, {
      boundary: 'integration.agent-tool',
    });
  });

  it('does not let session cleanup failures mask the tool outcome', async () => {
    const closeError = new Error('close failed');

    const result = await callIntegrationTool(createInput({closeError}));

    expect(result.outcome).toBe('success');
    expect(serviceMocks.loggerError).toHaveBeenCalledWith(
      {err: closeError},
      'Failed to close integration agent tool session',
    );
    expect(serviceMocks.reportError).toHaveBeenCalledWith(closeError, {
      boundary: 'integration.agent-tool',
      operation: 'close-session',
    });
  });

  it('omits an agent caller without a lease and uses the fallback method label', async () => {
    const input = createInput(
      {callError: new Error('internal failure')},
      {caller: {caller: 'agent'}, method: undefined},
    );

    await callIntegrationTool(input);

    expect(serviceMocks.loggerError.mock.calls[0]?.[0]).toEqual({
      caller: 'agent',
      connectionId: 'connection-1',
      provider: 'github',
      toolId: 'issue_read',
      method: 'none',
      err: expect.any(Error),
      errorCode: 'unknown',
    });
  });

  it('logs the tool-step caller identity with the error context', async () => {
    const input = createInput(
      {callError: new Error('internal failure')},
      {
        caller: {
          caller: 'tool_step',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          runId: 'run-1',
          jobExecutionId: 'execution-1',
          stepId: 'step-1',
          stepAttempt: 2,
          callIndex: 3,
        },
        method: undefined,
      },
    );

    await callIntegrationTool(input);

    expect(serviceMocks.loggerError.mock.calls[0]?.[0]).toEqual({
      caller: 'tool_step',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      runId: 'run-1',
      jobExecutionId: 'execution-1',
      stepId: 'step-1',
      stepAttempt: 2,
      callIndex: 3,
      connectionId: 'connection-1',
      provider: 'github',
      toolId: 'issue_read',
      method: 'none',
      err: expect.any(Error),
      errorCode: 'unknown',
    });
  });

  it('maps an in-flight signal abort to cancellation and still closes the session', async () => {
    const onClose = vi.fn();
    const onCall = vi.fn();
    const controller = new AbortController();
    let releaseCall: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseCall = resolve;
    });
    const input = createInput({onClose, onCall});
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: {
            catalog: () => [catalogTool()],
            selectionCatalog: () => ({selectors: []}),
            openSession: () =>
              Promise.resolve({
                call: (call: {toolId: string; arguments: Record<string, unknown>}) => {
                  onCall(call);
                  return gate.then(() => ({
                    content: [{type: 'text', text: 'late result'}],
                  }));
                },
                close: () => {
                  onClose();
                  return Promise.resolve();
                },
              }),
          },
        },
      },
    ]);

    const call = callIntegrationTool({...input, registry, signal: controller.signal});
    await vi.waitFor(() => expect(onCall).toHaveBeenCalledTimes(1));

    controller.abort();

    await expect(call).resolves.toEqual({
      outcome: 'error',
      error: {code: 'cancelled', message: 'Integration tool call cancelled'},
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
    releaseCall?.();
  });

  it('rejects without dispatching when the call signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const onOpenSession = vi.fn();

    const result = await callIntegrationTool(
      createInput({onOpenSession}, {signal: controller.signal, caller: {caller: 'agent'}}),
    );

    expect(result).toEqual({
      outcome: 'error',
      error: {code: 'cancelled', message: 'Integration tool call cancelled'},
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
  });

  it('does not load the catalog or authorization store after an early abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const onOpenSession = vi.fn();
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });
    const catalog = vi.spyOn(registry.getAdapter('github', 'agent_tools'), 'catalog');
    const resolveRepositoryAuthorization = vi.fn();

    const result = await callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
          signal: controller.signal,
        },
      ),
    );

    expect(result).toEqual({
      outcome: 'error',
      error: {code: 'cancelled', message: 'Integration tool call cancelled'},
    });
    expect(catalog).not.toHaveBeenCalled();
    expect(resolveRepositoryAuthorization).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it('stops waiting for authorization when the call signal aborts', async () => {
    const controller = new AbortController();
    const entry = catalogWithRepositoryScope(declaredRepositoryScope);
    const onOpenSession = vi.fn();
    let releaseAuthorization: ((result: RepositoryAuthorizationResult) => void) | undefined;
    const authorization = new Promise<RepositoryAuthorizationResult>((resolve) => {
      releaseAuthorization = resolve;
    });
    const resolveRepositoryAuthorization = vi.fn(() => authorization);
    const registry = registryWithAgentTools([entry], {
      repositoryAuthorization: 'enforced',
      onOpenSession,
    });

    const call = callIntegrationTool(
      createInput(
        {onOpenSession},
        {
          registry,
          catalogEntry: entry,
          repositoryAuthorizer: {enabled: true, resolveRepositoryAuthorization},
          signal: controller.signal,
        },
      ),
    );
    await vi.waitFor(() => expect(resolveRepositoryAuthorization).toHaveBeenCalledOnce());

    controller.abort();

    await expect(call).resolves.toEqual({
      outcome: 'error',
      error: {code: 'cancelled', message: 'Integration tool call cancelled'},
    });
    expect(onOpenSession).not.toHaveBeenCalled();
    releaseAuthorization?.({
      authorized: true,
      repository: {owner: 'shipfox', name: 'platform'},
    });
  });

  it('closes a session that resolves after an abort during session opening', async () => {
    const onClose = vi.fn();
    const controller = new AbortController();
    let releaseOpen: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    const input = createInput({onClose});
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: {
            catalog: () => [catalogTool()],
            selectionCatalog: () => ({selectors: []}),
            openSession: () =>
              gate.then(() => ({
                call: () => Promise.resolve({content: [{type: 'text', text: 'never called'}]}),
                close: () => {
                  onClose();
                  return Promise.resolve();
                },
              })),
          },
        },
      },
    ]);

    const call = callIntegrationTool({...input, registry, signal: controller.signal});
    await vi.waitFor(() => expect(releaseOpen).toBeDefined());

    controller.abort();

    await expect(call).resolves.toEqual({
      outcome: 'error',
      error: {code: 'cancelled', message: 'Integration tool call cancelled'},
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();

    releaseOpen?.();
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('maps a provider tool-level error result to a bounded error outcome', async () => {
    const result = await callIntegrationTool(
      createInput({
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'GitHub installation token is missing permission for this operation',
            },
          ],
          structuredContent: {code: 'access-denied', status: 403},
        },
      }),
    );

    expect(result).toEqual({
      outcome: 'error',
      error: {
        code: 'access-denied',
        message: 'GitHub installation token is missing permission for this operation',
        status: 403,
      },
    });
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
    expect(serviceMocks.reportError).not.toHaveBeenCalled();
  });

  it('keeps the backoff hint from a rate-limited provider tool error', async () => {
    const result = await callIntegrationTool(
      createInput({
        result: {
          isError: true,
          content: [
            {type: 'text', text: 'Rate limited'},
            {type: 'text', text: 'ignored'},
          ],
          structuredContent: {code: 'rate-limited', retryAfterSeconds: 30, status: 429},
        },
      }),
    );

    expect(result).toEqual({
      outcome: 'error',
      error: {
        code: 'rate-limited',
        message: 'Rate limited',
        retryAfterSeconds: 30,
        status: 429,
      },
    });
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
    expect(serviceMocks.reportError).not.toHaveBeenCalled();
  });

  it('uses method tokens and omits optional catalog fields when metadata is absent', async () => {
    const onOpenSession = vi.fn();
    const tool = materializedTool({
      methods: [
        {
          id: 'get',
          token: 'issue_read.get',
          description: undefined,
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [],
        },
      ],
      outputSchema: undefined,
    });
    const input = createInput(
      {onOpenSession},
      {tool, inputSchema: tool.inputSchema, outputSchema: undefined},
    );

    await callIntegrationTool(input);

    expect(onOpenSession).toHaveBeenCalledWith({
      connection: input.connection,
      tools: [
        expect.objectContaining({
          methods: [expect.objectContaining({id: 'get', description: 'issue_read.get'})],
        }),
      ],
    });
    expect(onOpenSession.mock.calls[0]?.[0].tools[0]).not.toHaveProperty('outputSchema');

    const toolWithoutMethods = materializedTool({methods: undefined, outputSchema: undefined});
    const inputWithoutMethods = createInput(
      {onOpenSession},
      {
        tool: toolWithoutMethods,
        inputSchema: toolWithoutMethods.inputSchema,
        outputSchema: undefined,
      },
    );

    await callIntegrationTool(inputWithoutMethods);

    expect(onOpenSession.mock.calls[1]?.[0].tools[0]).not.toHaveProperty('methods');
  });
});

function createInput(
  providerOptions: AgentToolsProviderOptions = {},
  overrides: Partial<IntegrationToolCallInput> = {},
): IntegrationToolCallInput {
  const integration = materializedIntegration({connectionId: 'connection-1'});
  const tool = materializedTool();
  return {
    registry: registryWithAgentTools([catalogTool()], providerOptions),
    connection: connection({
      id: 'connection-1',
      workspaceId: 'workspace-1',
      slug: integration.connectionSlug,
    }),
    integration,
    tool,
    description: 'Read issue metadata from GitHub.',
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
    method: 'get',
    caller: {
      caller: 'agent',
      lease: leaseContext({
        jobId: 'job-1',
        jobExecutionId: 'execution-1',
        workflowRunId: 'run-1',
        workflowRunAttemptId: 'attempt-1',
        workspaceId: 'workspace-1',
        currentStepId: 'step-1',
        currentStepAttempt: 2,
      }),
    },
    logger: loggerFactory,
    reportError,
    ...overrides,
  };
}

const declaredRepositoryScope: AgentToolRepositoryScopeClassifier = (arguments_) => ({
  kind: 'declared-targets',
  repositories: [
    {
      owner: String(arguments_.owner),
      name: String(arguments_.repo),
    },
  ],
});

describe('loadAuthorizedToolConnection', () => {
  const params = {
    workspaceId: 'workspace-1',
    connectionId: 'connection-1',
    provider: 'github',
    registry: registryWithAgentTools(),
  };

  it('returns the connection when every check passes', async () => {
    const resolved = connection({id: 'connection-1', workspaceId: 'workspace-1'});

    await expect(
      loadAuthorizedToolConnection({
        ...params,
        getIntegrationConnectionById: async () => resolved,
      }),
    ).resolves.toBe(resolved);
  });

  it('rejects when the connection is missing', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        getIntegrationConnectionById: async () => undefined,
      }),
    ).rejects.toThrow('not found');
  });

  it('rejects when the connection belongs to another workspace', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        getIntegrationConnectionById: async () =>
          connection({id: 'connection-1', workspaceId: 'other-workspace'}),
      }),
    ).rejects.toThrow('does not belong to the requested workspace');
  });

  it('rejects when the connection is not active', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        getIntegrationConnectionById: async () =>
          connection({id: 'connection-1', workspaceId: 'workspace-1', lifecycleStatus: 'disabled'}),
      }),
    ).rejects.toThrow('is not active');
  });

  it('rejects when the connection provider changed since materialization', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        getIntegrationConnectionById: async () =>
          connection({id: 'connection-1', workspaceId: 'workspace-1', provider: 'slack'}),
      }),
    ).rejects.toThrow('provider changed');
  });

  it('rejects with provider-unavailable when the provider is no longer registered', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        registry: createIntegrationProviderRegistry([]),
        getIntegrationConnectionById: async () =>
          connection({id: 'connection-1', workspaceId: 'workspace-1'}),
      }),
    ).rejects.toThrow('No integration provider registered for github');
  });

  it('rejects when the provider no longer exposes agent tools', async () => {
    await expect(
      loadAuthorizedToolConnection({
        ...params,
        registry: createIntegrationProviderRegistry([{provider: 'github', displayName: 'GitHub'}]),
        getIntegrationConnectionById: async () =>
          connection({id: 'connection-1', workspaceId: 'workspace-1'}),
      }),
    ).rejects.toThrow('does not expose');
  });
});
