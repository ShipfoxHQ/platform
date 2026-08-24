import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import type {z} from 'zod';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {IntegrationProviderError} from '#core/errors.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import type {SourceControlProvider} from '#core/providers/source-control.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
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
  ) {
    const transport = createInMemoryInterModuleTransport();
    const client = transport.createClient(integrationsInterModuleContract);
    transport.register(
      createIntegrationsInterModulePresentation({
        registry: registryWithAgentTools([catalogTool()], providerOptions),
        sourceControl: createSourceControlIntegrationService({
          registry: createIntegrationProviderRegistry([]),
          getIntegrationConnectionById: async () => undefined,
        }),
        getIntegrationConnectionById: resolveConnection,
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

  it('accepts the agent caller without tool-step identity fields', async () => {
    const client = createToolCallClient();

    const result = await client.callTool({...toolCallInput, caller: {kind: 'agent'}});

    expect(result.outcome).toBe('success');
  });

  it('rejects a frozen method outside the allowlist as an invalid-request outcome', async () => {
    const onCall = vi.fn();
    const client = createToolCallClient({onCall});

    const result = await client.callTool({
      ...toolCallInput,
      tool: {...toolCallInput.tool, method: 'get_labels'},
    });

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Unauthorized integration tool method: get_labels',
    });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('requires a frozen method for method-family tools', async () => {
    const client = createToolCallClient();
    const {method: _omitted, ...toolWithoutMethod} = toolCallInput.tool;

    const result = await client.callTool({...toolCallInput, tool: toolWithoutMethod});

    expect(result).toEqual({
      outcome: 'error',
      code: 'invalid-request',
      message: 'Method-family tools require a frozen method',
    });
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

  it('maps a per-call timeout to the provider-timeout error outcome', async () => {
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
                    // A call that never settles: only the per-call timeout can end it.
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

    const result = await client.callTool({...toolCallInput, timeoutMs: 20});

    expect(result).toEqual({
      outcome: 'error',
      code: 'provider-timeout',
      message: 'Integration provider timed out',
    });
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
});
