const {
  bridgeCloseMock,
  createIntegrationToolsBridgeMock,
  createIntegrationToolsGatewayFetchMock,
  gatewayFetch,
  runAgentMock,
  runClaudeMock,
} = vi.hoisted(() => {
  const bridgeCloseMock = vi.fn();
  const gatewayFetch = vi.fn();

  return {
    bridgeCloseMock,
    createIntegrationToolsBridgeMock: vi.fn((params: {name: string; preferredPort?: number}) => ({
      name: params.name,
      server: {},
      listTools: vi.fn(),
      callTool: vi.fn(),
      close: bridgeCloseMock,
    })),
    createIntegrationToolsGatewayFetchMock: vi.fn(() => gatewayFetch),
    gatewayFetch,
    runAgentMock: vi.fn(),
    runClaudeMock: vi.fn(),
  };
});

vi.mock('#core/pi-adapter.js', () => ({piHarnessAdapter: {run: runAgentMock}}));
vi.mock('#core/claude-adapter.js', () => ({claudeHarnessAdapter: {run: runClaudeMock}}));
vi.mock('#core/integration-tools-bridge.js', () => ({
  createIntegrationToolsBridge: createIntegrationToolsBridgeMock,
}));
vi.mock('@shipfox/runner-protocol', () => ({
  createIntegrationToolsGatewayFetch: createIntegrationToolsGatewayFetchMock,
}));

import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
} from '@shipfox/api-agent-dto';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentPermissionModeError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {HarnessInvocation} from '#core/harness.js';
import {executeAgentStep} from '#core/step.js';

const RUNTIME = {
  harness: 'pi' as const,
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  thinking: 'high',
  credentials: {api_key: 'sk-runtime-secret'},
};

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  const name =
    typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'implement';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'implement',
    name,
    source_location: null,
    status: 'running',
    status_reason: null,
    type: 'agent',
    config: {model: 'claude-opus-4-8', thinking: 'high', prompt: 'Fix the failing tests.'},
    error: null,
    evaluation_trace: null,
    session: null,
    position: 1,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('executeAgentStep', () => {
  beforeEach(() => {
    bridgeCloseMock.mockReset();
    createIntegrationToolsBridgeMock.mockClear();
    createIntegrationToolsGatewayFetchMock.mockClear();
    gatewayFetch.mockReset();
    runAgentMock.mockReset();
    runClaudeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs the agent and reports process-success with exit_code 0', async () => {
    runAgentMock.mockResolvedValue({response: 'done'});

    const result = await executeAgentStep(buildAgentStep(), {cwd: '/work', runtime: RUNTIME});

    expect(result).toEqual({success: true, response: 'done', error: null, exit_code: 0});
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/work',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix the failing tests.',
      }),
    );
  });

  it('forwards the runner-owned agent-state directory to the harness', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep(), {
      cwd: '/work',
      agentStateDir: '/runner-agent/job-1',
      runtime: RUNTIME,
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({agentStateDir: '/runner-agent/job-1'}),
    );
  });

  it('forwards runtime provider, model, and thinking to the agent invocation', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: {
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-openai'},
      },
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.1',
        thinking: 'medium',
        credentials: {api_key: 'sk-openai'},
      }),
    );
  });

  it('forwards declared outputs and returns collected outputs', async () => {
    runAgentMock.mockResolvedValue({outputs: {summary: 'done'}});
    const step = buildAgentStep({
      config: {
        prompt: 'p',
        outputs: {summary: {type: 'string'}},
      },
    });

    const result = await executeAgentStep(step, {runtime: RUNTIME});

    expect(result).toEqual({
      success: true,
      response: '',
      outputs: {summary: 'done'},
      error: null,
      exit_code: 0,
    });
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({outputs: {summary: {type: 'string'}}}),
    );
  });

  it('forwards selected tools to the agent invocation unchanged', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {prompt: 'p', tools: ['read', 'web_search']}}), {
      runtime: RUNTIME,
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'web_search']}),
    );
  });

  it('runs normally when integration tools are absent', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: RUNTIME,
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.not.objectContaining({mcpServers: expect.anything()}),
    );
    expect(createIntegrationToolsBridgeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-array MCP servers', {prompt: 'p', mcpServers: 'bad'}],
    ['empty MCP servers', {prompt: 'p', mcpServers: []}],
    ['wrong transport', {prompt: 'p', mcpServers: [integrationToolsConfig({transport: 'stdio'})]}],
    ['wrong auth', {prompt: 'p', mcpServers: [integrationToolsConfig({auth: 'provider_token'})]}],
  ])('fails with agent_config_invalid for %s', async (_name, config) => {
    const result = await executeAgentStep(buildAgentStep({config}), {runtime: RUNTIME});

    expect(result).toEqual({
      success: false,
      error: {
        message: 'Agent step config has invalid integration tools.',
        reason: 'agent_config_invalid',
        agent_config_issue: 'step_config_invalid',
      },
      exit_code: null,
    });
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('fails closed when integration tools are configured without bridge prerequisites', async () => {
    const result = await executeAgentStep(
      buildAgentStep({config: {prompt: 'p', mcpServers: [integrationToolsConfig()]}}),
      {runtime: RUNTIME},
    );

    expect(result).toEqual({
      success: false,
      error: {
        message: 'Agent step config has invalid integration tools.',
        reason: 'agent_config_invalid',
        agent_config_issue: 'step_config_invalid',
      },
      exit_code: null,
    });
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(createIntegrationToolsBridgeMock).not.toHaveBeenCalled();
  });

  it('constructs, forwards, and closes integration tool bridges around the harness run', async () => {
    runAgentMock.mockResolvedValue({});
    const leaseToken = () => 'lease-current';
    const gatewayUrl = new URL('https://api.example.test/runs/jobs/current/integration-tools/mcp');

    await executeAgentStep(
      buildAgentStep({config: {prompt: 'p', mcpServers: [integrationToolsConfig()]}}),
      {
        runtime: RUNTIME,
        leaseToken,
        integrationToolsGatewayUrl: gatewayUrl,
      },
    );

    expect(createIntegrationToolsGatewayFetchMock).toHaveBeenCalledWith(leaseToken, gatewayUrl);
    expect(createIntegrationToolsBridgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: AGENT_INTEGRATION_MCP_SERVER_NAME,
        url: gatewayUrl,
        fetch: gatewayFetch,
        preferredPort: expect.any(Number),
      }),
    );
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [expect.objectContaining({name: AGENT_INTEGRATION_MCP_SERVER_NAME})],
        requestedIntegrationTools: [{connectionSlug: 'github_main', toolId: 'issue_read'}],
      }),
    );
    expect(bridgeCloseMock).toHaveBeenCalledTimes(1);
  });

  it('derives deterministic bridge ports in the non-ephemeral range', async () => {
    runAgentMock.mockResolvedValue({});
    const step = buildAgentStep({config: {prompt: 'p', mcpServers: [integrationToolsConfig()]}});
    const options = {
      runtime: RUNTIME,
      leaseToken: 'lease-current',
      integrationToolsGatewayUrl: new URL(
        'https://api.example.test/runs/jobs/current/integration-tools/mcp',
      ),
    };

    await executeAgentStep(step, options);
    const firstPreferredPort = createIntegrationToolsBridgeMock.mock.calls[0]?.[0].preferredPort;

    createIntegrationToolsBridgeMock.mockClear();
    await executeAgentStep(step, options);
    const secondPreferredPort = createIntegrationToolsBridgeMock.mock.calls[0]?.[0].preferredPort;

    expect(firstPreferredPort).toBeGreaterThanOrEqual(25_000);
    expect(firstPreferredPort).toBeLessThan(32_768);
    expect(secondPreferredPort).toBe(firstPreferredPort);
  });

  it('closes integration tool bridges when the harness run fails', async () => {
    runAgentMock.mockRejectedValue(new Error('provider failed'));

    const result = await executeAgentStep(
      buildAgentStep({config: {prompt: 'p', mcpServers: [integrationToolsConfig()]}}),
      {
        runtime: RUNTIME,
        leaseToken: 'lease-current',
        integrationToolsGatewayUrl: new URL(
          'https://api.example.test/runs/jobs/current/integration-tools/mcp',
        ),
      },
    );

    expect(result.success).toBe(false);
    expect(bridgeCloseMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the harness result when closing an integration tool bridge fails', async () => {
    runAgentMock.mockResolvedValue({response: 'done'});
    bridgeCloseMock.mockRejectedValueOnce(new Error('close failed'));

    const result = await executeAgentStep(
      buildAgentStep({config: {prompt: 'p', mcpServers: [integrationToolsConfig()]}}),
      {
        runtime: RUNTIME,
        leaseToken: 'lease-current',
        integrationToolsGatewayUrl: new URL(
          'https://api.example.test/runs/jobs/current/integration-tools/mcp',
        ),
      },
    );

    expect(result).toEqual({success: true, response: 'done', error: null, exit_code: 0});
    expect(bridgeCloseMock).toHaveBeenCalledTimes(1);
  });

  it('forwards custom provider runtime config to the agent invocation', async () => {
    runAgentMock.mockResolvedValue({});
    const customProvider = {
      api: 'openai-responses' as const,
      base_url: 'https://models.example.test/v1',
      headers: [{name: 'x-plain', value: 'plain'}],
      secret_header_names: ['x-secret'],
      models: [{id: 'custom-gpt', label: 'Custom GPT'}],
      requires_api_key: true,
    };

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: {
        harness: 'pi',
        provider: 'workspace-models',
        model: 'custom-gpt',
        thinking: 'medium',
        credentials: {api_key: 'sk-custom'},
        custom_provider: customProvider,
      },
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'workspace-models',
        model: 'custom-gpt',
        customProvider,
      }),
    );
  });

  it('forwards Claude runtime config to the agent invocation', async () => {
    runClaudeMock.mockResolvedValue({});
    const claude = {
      base_url: 'https://gateway.example.test/v1',
      auth_token: 'managed-token',
    };

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: {
        ...RUNTIME,
        harness: 'claude',
        claude,
      },
    });

    expect(runClaudeMock).toHaveBeenCalledWith(expect.objectContaining({claude}));
  });

  it('forwards the ambient git config path to the agent invocation', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(buildAgentStep({config: {prompt: 'p'}}), {
      runtime: RUNTIME,
      gitConfigGlobal: '/runner-cred/job-1/git-cred.config',
    });

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({gitConfigGlobal: '/runner-cred/job-1/git-cred.config'}),
    );
  });

  it('ignores stale provider, model, and thinking values in step config', async () => {
    runAgentMock.mockResolvedValue({});

    await executeAgentStep(
      buildAgentStep({
        config: {provider: 'anthropic', model: 'claude-opus-4-8', thinking: 'high', prompt: 'p'},
      }),
      {
        runtime: {
          harness: 'pi',
          provider: 'openai',
          model: 'gpt-5.1',
          thinking: 'low',
          credentials: {api_key: 'sk-openai'},
        },
      },
    );

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({provider: 'openai', model: 'gpt-5.1', thinking: 'low'}),
    );
  });

  it('fails with agent_invocation_failed when the agent run throws a generic error', async () => {
    runAgentMock.mockRejectedValue(new Error('provider returned 503'));

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      message: 'provider returned 503',
      reason: 'agent_invocation_failed',
    });
    expect(result.exit_code).toBeNull();
  });

  it('fails and logs when Claude permission mode is downgraded', async () => {
    const errorLog = vi.spyOn(logger(), 'error').mockImplementation(() => undefined);
    runClaudeMock.mockRejectedValue(new AgentPermissionModeError('bypassPermissions', 'default'));

    const result = await executeAgentStep(buildAgentStep(), {
      runtime: {...RUNTIME, harness: 'claude'},
    });

    expect(result).toEqual({
      success: false,
      error: {
        message:
          'Claude agent permission mode was downgraded: requested "bypassPermissions", observed "default".',
        reason: 'agent_invocation_failed',
      },
      exit_code: null,
    });
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_permission_mode_downgraded',
        harness: 'claude',
        jobExecutionId: '00000000-0000-0000-0000-000000000003',
        stepId: '00000000-0000-0000-0000-000000000001',
        attempt: 1,
        requestedPermissionMode: 'bypassPermissions',
        observedPermissionMode: 'default',
      }),
      'Agent permission mode downgraded',
    );
  });

  it('fails with agent_config_invalid when the agent run throws an AgentConfigError', async () => {
    runAgentMock.mockRejectedValue(
      new AgentConfigError('Unknown provider "foo" for agent step.', 'provider_unsupported'),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      message: 'Unknown provider "foo" for agent step.',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_unsupported',
    });
  });

  it('fails with agent_harness_unavailable without an agent config issue', async () => {
    runAgentMock.mockRejectedValue(
      new AgentHarnessUnavailableError({
        diagnostics: [{type: 'error', message: 'Unknown option: --mcp-config'}],
        environment: {
          cwd: '/work',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          thinking: 'high',
          extensionPaths: ['pi-web-access', 'pi-mcp-adapter'],
        },
      }),
    );
    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});
    expect(result).toEqual({
      success: false,
      error: {
        message: 'Pi extension setup failed: Unknown option: --mcp-config',
        reason: 'agent_harness_unavailable',
      },
      exit_code: null,
    });
  });

  it('logs bounded harness diagnostics with step and build identity', async () => {
    vi.stubEnv('RUNNER_VERSION', '0.1.13');
    vi.stubEnv('IMAGE_REVISION', '0123456789abcdef');
    vi.stubEnv('IMAGE_CREATED', '2026-07-27T10:00:00.000Z');
    vi.stubEnv('BUILD_NUMBER', '42');
    const errorLog = vi.spyOn(logger(), 'error').mockImplementation(() => undefined);
    runAgentMock.mockRejectedValue(
      new AgentHarnessUnavailableError({
        diagnostics: Array.from({length: 6}, (_, index) => ({
          type: 'error' as const,
          message: `${index}:${'x'.repeat(600)}`,
        })),
        environment: {
          cwd: '/work',
          provider: 'anthropic',
          model: 'claude-opus-4-8',
          thinking: 'high',
          extensionPaths: ['pi-web-access'],
          resolvedExtensionPaths: ['/app/node_modules/pi-web-access/index.js'],
        },
        resourceLoaderErrors: [
          {path: '/app/node_modules/pi-web-access', error: 'Extension path does not exist'},
        ],
      }),
    );

    await executeAgentStep(buildAgentStep({current_attempt: 3}), {cwd: '/work', runtime: RUNTIME});

    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_harness_unavailable',
        harness: 'pi',
        jobExecutionId: '00000000-0000-0000-0000-000000000003',
        stepId: '00000000-0000-0000-0000-000000000001',
        attempt: 3,
        requestedExtensionPaths: ['pi-web-access'],
        resolvedExtensionPaths: ['/app/node_modules/pi-web-access/index.js'],
        runnerVersion: '0.1.13',
        imageRevision: '0123456789abcdef',
        imageCreated: '2026-07-27T10:00:00.000Z',
        buildNumber: '42',
      }),
      'Agent harness unavailable',
    );
    const fields = errorLog.mock.calls[0]?.[0] as {
      diagnostics: Array<{message: string}>;
      resourceLoaderErrors: Array<{error: string}>;
    };
    expect(fields.diagnostics).toHaveLength(5);
    expect(fields.diagnostics[0]?.message).toHaveLength(500);
    expect(fields.resourceLoaderErrors).toEqual([
      {path: '/app/node_modules/pi-web-access', error: 'Extension path does not exist'},
    ]);
  });

  it('maps an unavailable session failure', async () => {
    runAgentMock.mockRejectedValue(
      new AgentSessionUnavailableError('Pi could not load the agent session: invalid session file'),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result).toEqual({
      success: false,
      error: {
        message: 'Pi could not load the agent session: invalid session file',
        reason: 'agent_session_unavailable',
      },
      exit_code: null,
    });
  });

  it('preserves response from invocation failures that can report it', async () => {
    runAgentMock.mockRejectedValue(
      new AgentInvocationError('Agent step finished without required outputs: summary', 'partial'),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result).toEqual({
      success: false,
      response: 'partial',
      error: {
        message: 'Agent step finished without required outputs: summary',
        reason: 'agent_invocation_failed',
      },
      exit_code: null,
    });
  });

  it('exposes a bounded invocation failure phase in the step error', async () => {
    runAgentMock.mockRejectedValue(
      new AgentInvocationError(
        'Agent step finished without required outputs: summary',
        'partial',
        undefined,
        undefined,
        'output_gate_failed',
      ),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result.error).toEqual({
      message: 'Agent step finished without required outputs: summary',
      reason: 'agent_invocation_failed',
      code: 'output_gate_failed',
    });
  });

  it('preserves session metadata on invocation failures', async () => {
    runAgentMock.mockRejectedValue(
      new AgentInvocationError(
        'Agent provider failed after writing a transcript',
        'partial',
        '/runner-agent/job-1/session.jsonl',
        'native-session-1',
      ),
    );

    const result = await executeAgentStep(buildAgentStep(), {runtime: RUNTIME});

    expect(result).toEqual({
      success: false,
      response: 'partial',
      sessionFile: '/runner-agent/job-1/session.jsonl',
      sessionId: 'native-session-1',
      error: {
        message: 'Agent provider failed after writing a transcript',
        reason: 'agent_invocation_failed',
      },
      exit_code: null,
    });
  });

  it('does not preserve session metadata on fork invocation failures', async () => {
    runAgentMock.mockRejectedValue(
      new AgentInvocationError(
        'Agent provider failed after writing a transcript',
        'partial',
        '/runner-agent/job-1/fork.jsonl',
        'native-session-1',
      ),
    );

    const result = await executeAgentStep(buildAgentStep(), {
      runtime: RUNTIME,
      session: {mode: 'fork'},
    });

    expect(result.sessionFile).toBeUndefined();
    expect(result.sessionId).toBeUndefined();
  });

  it('lazily selects the Claude adapter without falling back to pi', async () => {
    runClaudeMock.mockResolvedValue({response: 'claude done'});

    const result = await executeAgentStep(buildAgentStep(), {
      runtime: {...RUNTIME, harness: 'claude'},
    });

    expect(result).toEqual({success: true, response: 'claude done', error: null, exit_code: 0});
    expect(runAgentMock).not.toHaveBeenCalled();
    expect(runClaudeMock).toHaveBeenCalledWith(expect.objectContaining({provider: 'anthropic'}));
  });

  it('rejects a non-agent step type without running the agent', async () => {
    const result = await executeAgentStep(buildAgentStep({type: 'run', config: {run: 'x'}}), {
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Unsupported step type');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('fails with agent_config_invalid when the config is missing prompt', async () => {
    const result = await executeAgentStep(buildAgentStep({config: {model: 'm'}}), {
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
    expect(result.error?.reason).toBe('agent_config_invalid');
    expect(result.error?.agent_config_issue).toBe('step_config_invalid');
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-array tools', {prompt: 'p', tools: 'read'}],
    ['empty tools', {prompt: 'p', tools: []}],
    ['non-string tool', {prompt: 'p', tools: ['read', 1]}],
    ['empty tool name', {prompt: 'p', tools: ['read', '']}],
  ])('fails with agent_config_invalid for %s', async (_name, config) => {
    const result = await executeAgentStep(buildAgentStep({config}), {runtime: RUNTIME});

    expect(result).toEqual({
      success: false,
      error: {
        message: 'Agent step config has invalid tools.',
        reason: 'agent_config_invalid',
        agent_config_issue: 'step_config_invalid',
      },
      exit_code: null,
    });
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it('returns promptly when the signal aborts even if the agent run never resolves', async () => {
    const ac = new AbortController();
    let sawSignal: AbortSignal | undefined;
    runAgentMock.mockImplementation((invocation: HarnessInvocation) => {
      sawSignal = invocation.signal;
      // Never settles, proving executeAgentStep returns via the abort race, not the run.
      return new Promise<never>(() => {
        // intentionally pending forever
      });
    });

    const promise = executeAgentStep(buildAgentStep(), {signal: ac.signal, runtime: RUNTIME});
    ac.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(sawSignal).toBe(ac.signal);
  });

  it('fails without crashing when the signal is already aborted before the call', async () => {
    const ac = new AbortController();
    ac.abort();
    runAgentMock.mockRejectedValue(new Error('agent rejected after abort'));

    const result = await executeAgentStep(buildAgentStep(), {
      signal: ac.signal,
      runtime: RUNTIME,
    });

    expect(result.success).toBe(false);
  });
});

function integrationToolsConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: AGENT_INTEGRATION_MCP_SERVER_NAME,
    transport: AGENT_INTEGRATION_MCP_TRANSPORT,
    endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
    auth: AGENT_INTEGRATION_MCP_AUTH,
    integrations: [
      {
        connectionId: 'connection-1',
        connectionSlug: 'github_main',
        provider: 'github',
        requiredScope: [],
        tools: [
          {
            id: 'issue_read',
            sensitivity: 'read',
            sensitive: false,
            requiredScope: [],
            inputSchema: {type: 'object'},
          },
        ],
      },
    ],
    ...overrides,
  };
}
