import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import type {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {IntegrationProviderError} from '#core/errors.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import type {SourceControlProvider} from '#core/providers/source-control.js';
import type {RepositoryAuthorizer} from '#core/repository-authorizer.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import type {
  IntegrationToolCallCaller,
  IntegrationToolCallRecorder,
} from '#core/tool-call-audit.js';
import {
  type AgentToolsProviderOptions,
  catalogTool,
  connection,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const workspaceId = crypto.randomUUID();
const connectionId = crypto.randomUUID();

function createClient(
  resolveRef: (input: {ref: string}) => Promise<{ref: string; commit: string}>,
  resolveRepository: SourceControlProvider['resolveRepository'] = () => {
    throw new Error('not used');
  },
  createCheckoutCredentials: SourceControlProvider['createCheckoutCredentials'] = async () => ({
    username: 'x-access-token',
    token: 'token',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
  }),
) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);

  const sourceControl = createSourceControlIntegrationService({
    registry: createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: {
            listRepositories: vi.fn(),
            resolveRepository: vi.fn(resolveRepository),
            listFiles: vi.fn(),
            fetchFile: vi.fn(),
            resolveTriggerReference: () => null,
            resolveRef: async (input) => await resolveRef(input),
            createCheckoutCredentials,
          },
        },
      },
    ]),
    getIntegrationConnectionById: async (id) => {
      await Promise.resolve();
      return id === connectionId
        ? {
            id: connectionId,
            workspaceId,
            provider: 'gitea',
            externalAccountId: 'gitea-owner',
            slug: 'gitea_owner',
            displayName: 'Gitea',
            lifecycleStatus: 'active' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined;
    },
  });

  transport.register(
    createIntegrationsInterModulePresentation({
      registry: createIntegrationProviderRegistry([]),
      sourceControl,
    }),
  );
  transport.seal();
  return client;
}

describe('integrations inter-module presentation', () => {
  const input = {
    workspaceId,
    connectionId,
    externalRepositoryId: 'gitea:gitea-owner/platform',
  };

  it('round-trips credential-only checkout delivery through the transport', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async (_input) => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: 'generation-2',
        renewal: {mode: 'refresh-at', refreshAt: new Date('2026-12-31T23:55:00.000Z')},
      }),
    );

    const result = await client.createCheckoutCredentials({
      workspaceId,
      connectionId,
      externalRepositoryId: 'gitea:gitea-owner/platform',
      permissions: {contents: 'read'},
      rejectedGeneration: 'generation-1',
    });

    expect(result).toEqual({
      username: 'x-access-token',
      token: 'secret',
      expiresAt: '2027-01-01T00:00:00.000Z',
      generation: 'generation-2',
      renewal: {mode: 'refresh-at', refreshAt: '2026-12-31T23:55:00.000Z'},
    });
  });

  it('rejects a provider response that echoes the rejected generation', async () => {
    const client = createClient(
      async () => ({ref: 'main', commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2026-01-01T00:00:00.000Z'),
        generation: 'rejected-generation',
      }),
    );

    const error = await client
      .createCheckoutCredentials({
        ...input,
        permissions: {contents: 'read'},
        rejectedGeneration: 'rejected-generation',
      })
      .catch((caught: unknown) => caught);

    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutCredentials,
        error,
      )
    ) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({reason: 'provider-rejected'});
    } else {
      throw error;
    }
  });

  it('round-trips on-rejection renewal without a refresh timestamp', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: 'generation-2',
        renewal: {mode: 'on-rejection'},
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).resolves.toEqual({
      username: 'x-access-token',
      token: 'secret',
      expiresAt: '2027-01-01T00:00:00.000Z',
      generation: 'generation-2',
      renewal: {mode: 'on-rejection'},
    });
  });

  it('rejects an empty credential generation at the transport boundary', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        generation: '',
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).rejects.toBeDefined();
  });

  it.each([
    ['after expiry', '2027-01-01T00:01:00.000Z'],
    ['already past', '2020-01-01T00:00:00.000Z'],
  ])('rejects a refresh-at renewal that is %s', async (_case, refreshAt) => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      undefined,
      async () => ({
        username: 'x-access-token',
        token: 'secret',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        renewal: {mode: 'refresh-at', refreshAt: new Date(refreshAt)},
      }),
    );

    await expect(
      client.createCheckoutCredentials({...input, permissions: {contents: 'read'}}),
    ).rejects.toBeDefined();
  });

  it('resolves a source ref through the transport', async () => {
    const client = createClient(async (input) => ({
      ref: input.ref,
      commit: 'a'.repeat(40),
    }));

    const result = await client.resolveSourceRef({...input, ref: 'refs/heads/main'});

    expect(result).toEqual({ref: 'refs/heads/main', commit: 'a'.repeat(40)});
  });

  it('maps a missing ref to the ref-not-found known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-not-found', 'Ref not found');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/missing'})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error),
    ).toBe(true);
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-not-found');
      expect(error.details).toEqual({ref: 'refs/heads/missing'});
    }
  });

  it('maps an invalid ref to the ref-invalid known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-invalid', 'Ref is not a branch or tag name');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'a'.repeat(40)})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-invalid');
      expect(error.details).toEqual({ref: 'a'.repeat(40)});
    } else {
      throw error;
    }
  });

  it('keeps other provider failures as provider-failure known errors', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('rate-limited', 'Rate limited', 60);
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/main'})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({reason: 'rate-limited', retryAfterSeconds: 60});
    } else {
      throw error;
    }
  });

  it('keeps ref reasons generic for methods that do not declare ref errors', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      () => {
        throw new IntegrationProviderError('ref-not-found', 'Ref not found');
      },
    );

    const error = await client.resolveSourceRepository(input).catch((caught: unknown) => caught);

    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        error,
      )
    ) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({reason: 'ref-not-found'});
    } else {
      throw error;
    }
  });

  it('serves provider event catalogs and fixed event providers on the validation context', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);

    const sourceControl = createSourceControlIntegrationService({
      registry: createIntegrationProviderRegistry([]),
      getIntegrationConnectionById: async () => undefined,
    });
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {
            provider: 'github',
            displayName: 'GitHub',
            eventCatalog: {
              provider: 'GitHub',
              events: [
                {
                  name: 'push',
                  summary: 'A push.',
                  emittedWhen: 'GitHub sends a push webhook.',
                  payloadKind: 'raw-provider',
                },
              ],
            },
          },
          {
            provider: 'webhook',
            displayName: 'Webhook',
            eventCatalog: {
              provider: 'Custom webhook',
              events: [
                {
                  name: 'received',
                  summary: 'A webhook request is accepted.',
                  emittedWhen: 'Shipfox accepts a request.',
                  payloadKind: 'shipfox-normalized',
                },
              ],
            },
          },
          {provider: 'gitea', displayName: 'Gitea'},
        ]),
        sourceControl,
      }),
    );
    transport.seal();

    const context = await client.getAgentToolsContext({
      workspaceId,
      defaultConnectionId: connectionId,
    });

    expect(context.eventCatalogs).toEqual([
      {provider: 'github', events: ['push']},
      {provider: 'webhook', events: ['received']},
    ]);
    expect(context.fixedEventProviders).toEqual(['webhook']);
  });
});

describe('integrations inter-module callTool', () => {
  const toolCallInput: z.input<typeof integrationsInterModuleContract.methods.callTool.input> = {
    workspaceId,
    connectionId,
    tool: {
      id: 'issue_read',
      provider: 'github',
      method: 'get',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [],
      inputSchema: catalogTool().inputSchema,
      outputSchema: catalogTool().outputSchema,
      methods: [
        {
          id: 'get',
          token: 'issue_read.get',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [],
        },
      ],
    },
    arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
    caller: {
      kind: 'tool_step',
      projectId: 'project-1',
      runId: 'run-1',
      jobExecutionId: 'execution-1',
      stepId: 'step-1',
      stepAttempt: 2,
      callIndex: 3,
    },
  };

  function createToolCallClient(
    providerOptions: AgentToolsProviderOptions = {},
    resolveConnection: (id: string) => Promise<IntegrationConnection | undefined> = async () =>
      connection({id: connectionId, workspaceId}),
    createRecorder:
      | ((caller: IntegrationToolCallCaller) => IntegrationToolCallRecorder)
      | undefined = undefined,
    catalog = [catalogTool()],
    options: {
      repositoryAuthorizer?: RepositoryAuthorizer | undefined;
    } = {},
  ) {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: registryWithAgentTools(catalog, providerOptions),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: resolveConnection,
        repositoryAuthorizer: options.repositoryAuthorizer,
        ...(createRecorder === undefined
          ? {}
          : {createIntegrationToolCallRecorder: createRecorder}),
      }),
    );
    transport.seal();
    return client;
  }

  it('calls the frozen tool through a single-tool provider session', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'success',
      result: {
        status: 'dispatched',
        provider: 'github',
        connection_id: connectionId,
        tool_id: 'issue_read',
        method: 'get',
      },
      content: [{type: 'text', text: 'dispatched'}],
    });
    expect(onCall).toHaveBeenCalledWith({
      toolId: 'issue_read',
      arguments: toolCallInput.arguments,
    });
  });

  it('denies a repository before deterministic dispatch and audits the run project', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogTool({
      repositoryScope: () => ({
        kind: 'declared-targets',
        repositories: [{owner: 'shipfox', name: 'platform'}],
      }),
    });
    const resolveRepositoryAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'repository_not_granted' as const,
    }));
    const recorder = vi.fn();
    const client = createToolCallClient(
      {repositoryAuthorization: 'enforced', onOpenSession},
      undefined,
      () => recorder,
      [entry],
      {
        repositoryAuthorizer: {
          enabled: true,
          resolveRepositoryAuthorization,
        },
      },
    );

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'repository-not-granted',
      message: 'Repository is not authorized for this integration connection',
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledTimes(1);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'repository-not-granted',
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'declared-targets',
        repositoryAccess: 'selected',
        decision: 'denied',
        denialReason: 'repository_not_granted',
        runProjectId: 'project-1',
      }),
    );
  });

  it('accepts the agent caller without tool-step identity fields', async () => {
    const client = createToolCallClient();

    const result = await client.callTool({...toolCallInput, caller: {kind: 'agent'}});

    expect(result.outcome).toBe('success');
  });

  it('rejects an executed method outside the frozen catalog allowlist as an invalid-request outcome', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool({
      ...toolCallInput,
      arguments: {...toolCallInput.arguments, method: 'get_comments'},
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unauthorized integration tool method: get_comments',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('rejects a method-family call without a string method argument', async () => {
    const client = createToolCallClient();
    const {method: _omitted, ...argumentsWithoutMethod} = toolCallInput.arguments;

    const result = await client.callTool({...toolCallInput, arguments: argumentsWithoutMethod});

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Method-family tools require a string method argument',
    });
  });

  it('rejects a tool id that is no longer in the live catalog', async () => {
    const client = createToolCallClient();

    const result = await client.callTool({
      ...toolCallInput,
      tool: {...toolCallInput.tool, id: 'removed_tool'},
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unknown integration tool: removed_tool',
    });
  });

  it('rejects a frozen method that is no longer in the live catalog', async () => {
    const onCall = vi.fn();
    const liveCatalogTool = catalogTool();
    const liveMethod = liveCatalogTool.methods?.find((method) => method.id === 'get_comments');
    if (!liveMethod) throw new Error('Missing live fixture method');
    const client = createToolCallClient({onCall}, undefined, undefined, [
      catalogTool({methods: [liveMethod]}),
    ]);

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unauthorized integration tool method: get',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  const connectionFailureCases: ReadonlyArray<
    [string, (id: string) => Promise<IntegrationConnection | undefined>]
  > = [
    ['connection-not-found', async () => undefined],
    [
      'connection-workspace-mismatch',
      async () => connection({id: connectionId, workspaceId: 'other-workspace'}),
    ],
    [
      'connection-inactive',
      async () => connection({id: connectionId, workspaceId, lifecycleStatus: 'disabled'}),
    ],
    [
      'connection-provider-changed',
      async () => connection({id: connectionId, workspaceId, provider: 'slack'}),
    ],
  ];

  it.each(
    connectionFailureCases,
  )('maps a %s connection state to its known error', async (code, resolveConnection) => {
    const client = createToolCallClient({}, resolveConnection);

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe(code);
      expect(error.details).toEqual({connectionId});
    }
  });

  it('maps a missing agent-tools capability to its known error', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([{provider: 'github', displayName: 'GitHub'}]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe('capability-unavailable');
      expect(error.details).toEqual({provider: 'github', capability: 'agent_tools'});
    }
  });

  it('maps a missing provider to the provider-unavailable known error', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    const error = await client.callTool(toolCallInput).catch((caught: unknown) => caught);

    expect(isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)).toBe(
      true,
    );
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.callTool, error)) {
      expect(error.code).toBe('provider-unavailable');
      expect(error.details).toEqual({provider: 'github'});
    }
  });

  it('cancels a call whose transport deadline elapses while the provider call is in flight', async () => {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: createIntegrationProviderRegistry([
          {
            provider: 'github',
            displayName: 'GitHub',
            adapters: {
              agent_tools: {
                catalog: () => [catalogTool()],
                selectionCatalog: () => ({selectors: []}),
                openSession: () =>
                  Promise.resolve({
                    // A call that never settles: only the deadline can end it.
                    call: () => new Promise(() => undefined),
                    close: () => Promise.resolve(),
                  }),
              },
            },
          },
        ]),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
      }),
    );
    transport.seal();

    await expect(
      client.callTool(toolCallInput, {signal: AbortSignal.timeout(20)}),
    ).rejects.toMatchObject({name: 'TimeoutError'});
  });

  it('maps a deadline abort during the provider call to a provider-timeout outcome', async () => {
    const transport = createInMemoryInterModuleTransport();
    const presentation = createIntegrationsInterModulePresentation({
      registry: createIntegrationProviderRegistry([
        {
          provider: 'github',
          displayName: 'GitHub',
          adapters: {
            agent_tools: {
              catalog: () => [catalogTool()],
              selectionCatalog: () => ({selectors: []}),
              openSession: () =>
                Promise.resolve({
                  // A call that never settles: only the deadline can end it.
                  call: () => new Promise(() => undefined),
                  close: () => Promise.resolve(),
                }),
            },
          },
        },
      ]),
      sourceControl: createSourceControlIntegrationService({
        registry: createIntegrationProviderRegistry([]),
        getIntegrationConnectionById: async () => undefined,
      }),
      getIntegrationConnectionById: async () => connection({id: connectionId, workspaceId}),
    });
    transport.register(presentation);
    transport.seal();

    const result = await presentation.handlers.callTool(toolCallInput, {
      signal: AbortSignal.timeout(20),
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    });
  });

  it('keeps a completed call success when the audit recorder throws', async () => {
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      () => () => {
        throw new Error('audit backend unavailable');
      },
    );

    const result = await client.callTool(toolCallInput);

    expect(result.outcome).toBe('success');
  });

  it('propagates a provider error with retry and status details', async () => {
    const client = createToolCallClient({
      callError: new IntegrationProviderError('rate-limited', 'Try again later', 30, 429),
    });

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'error',
      code: 'rate-limited',
      message: 'Try again later',
      retryAfterSeconds: 30,
      status: 429,
    });
  });

  it('falls back to a null structured result for text-only provider results', async () => {
    const client = createToolCallClient({
      result: {content: [{type: 'text', text: 'dispatched'}]},
    });

    const result = await client.callTool(toolCallInput);

    expect(result).toEqual({
      outcome: 'success',
      result: null,
      content: [{type: 'text', text: 'dispatched'}],
    });
  });

  it('records the executed method, outcome, and caller on the audit recorder for a successful call', async () => {
    const recorder = vi.fn();
    const createdCallers: IntegrationToolCallCaller[] = [];
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      (caller) => {
        createdCallers.push(caller);
        return recorder;
      },
    );

    await client.callTool(toolCallInput);

    expect(createdCallers[0]).toMatchObject({caller: 'tool_step', workspaceId, runId: 'run-1'});
    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizedTool: expect.objectContaining({
          tool: expect.objectContaining({id: 'issue_read'}),
        }),
        method: 'get',
        outcome: 'success',
        errorCode: 'none',
      }),
    );
  });

  it('records provider error details on the audit recorder', async () => {
    const recorder = vi.fn();
    const client = createToolCallClient(
      {callError: new IntegrationProviderError('rate-limited', 'Try again later', 30, 429)},
      async () => connection({id: connectionId, workspaceId}),
      () => recorder,
    );

    await client.callTool(toolCallInput);

    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'rate-limited',
        providerStatus: 429,
      }),
    );
  });

  it('records an invalid-request audit line for a rejected executed method', async () => {
    const recorder = vi.fn();
    const client = createToolCallClient(
      {},
      async () => connection({id: connectionId, workspaceId}),
      () => recorder,
    );

    await client.callTool({
      ...toolCallInput,
      arguments: {...toolCallInput.arguments, method: 'get_labels'},
    });

    expect(recorder).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'invalid',
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      }),
    );
  });
});
