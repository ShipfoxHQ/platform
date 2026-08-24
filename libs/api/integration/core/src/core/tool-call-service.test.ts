import type {reportError as reportErrorType} from '@shipfox/node-error-monitoring';
import type {logger as loggerFactoryType} from '@shipfox/node-opentelemetry';
import {
  type AgentToolsProviderOptions,
  catalogTool,
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {IntegrationProviderError} from './errors.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';
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
      'timeouts map to provider-timeout',
      Object.assign(new Error('request timed out'), {name: 'TimeoutError'}),
      {code: 'provider-timeout', message: 'Integration provider timed out'},
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

  it('maps a call-time signal abort to provider-timeout and still closes the session', async () => {
    const onClose = vi.fn();
    const onCall = vi.fn();
    const controller = new AbortController();
    const input = createInput({onClose, onCall});

    const call = callIntegrationTool({...input, signal: controller.signal});
    controller.abort();

    await expect(call).resolves.toEqual({
      outcome: 'error',
      error: {code: 'provider-timeout', message: 'Integration provider timed out'},
    });
    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(serviceMocks.loggerError).not.toHaveBeenCalled();
  });

  it('rejects immediately when the call signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await callIntegrationTool(
      createInput({}, {signal: controller.signal, caller: {caller: 'agent'}}),
    );

    expect(result).toEqual({
      outcome: 'error',
      error: {code: 'provider-timeout', message: 'Integration provider timed out'},
    });
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
