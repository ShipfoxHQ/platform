const {
  createAgentSessionMock,
  createAgentSessionServicesMock,
  findMock,
  getAllMock,
  hasConfiguredAuthMock,
  registerProviderMock,
  modelRuntimeCreateMock,
  defineToolMock,
  promptMock,
  abortMock,
  bindExtensionsMock,
  getLastAssistantTextMock,
  disposeMock,
  extensionShutdownMock,
} = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  createAgentSessionServicesMock: vi.fn(),
  findMock: vi.fn(),
  getAllMock: vi.fn(),
  hasConfiguredAuthMock: vi.fn(),
  registerProviderMock: vi.fn(),
  defineToolMock: vi.fn((tool) => tool),
  promptMock: vi.fn(),
  abortMock: vi.fn(),
  bindExtensionsMock: vi.fn(),
  getLastAssistantTextMock: vi.fn(),
  disposeMock: vi.fn(),
  extensionShutdownMock: vi.fn(),
  modelRuntimeCreateMock: vi.fn(),
}));
const {assertEgressAllowedMock, EgressDeniedErrorMock} = vi.hoisted(() => {
  class EgressDeniedError extends Error {
    constructor(
      public readonly reason: string,
      public readonly target: string,
    ) {
      super(`Egress denied for ${target}: ${reason}`);
      this.name = 'EgressDeniedError';
    }
  }

  return {assertEgressAllowedMock: vi.fn(), EgressDeniedErrorMock: EgressDeniedError};
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionFromServices: createAgentSessionMock,
  createAgentSessionServices: createAgentSessionServicesMock,
  defineTool: defineToolMock,
  ModelRuntime: {
    create: modelRuntimeCreateMock,
  },
  SessionManager: {create: () => ({})},
}));

vi.mock('@shipfox/node-egress-guard', () => ({
  assertEgressAllowed: assertEgressAllowedMock,
  EgressDeniedError: EgressDeniedErrorMock,
  parseEgressHostDenylist: (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
}));

import {appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {AgentConfigError, AgentHarnessUnavailableError} from '#core/errors.js';
import type {HarnessInvocation} from '#core/harness.js';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';
import {piExtensionDirectories} from '#core/pi-extensions.js';

const piWebAccessDirectory = piExtensionDirectories({packageNames: ['pi-web-access']})[0];
const piMcpAdapterDirectory = piExtensionDirectories({packageNames: ['pi-mcp-adapter']})[0];

function piServices(cwd = '/work', diagnostics: Array<{type: string; message: string}> = []) {
  return {
    cwd,
    diagnostics,
    resourceLoader: {
      getExtensions: () => ({
        extensions: [piWebAccessDirectory, piMcpAdapterDirectory].map((directory) => ({
          resolvedPath: `${directory}/index.ts`,
        })),
        errors: [],
      }),
    },
  };
}

function invocation(overrides: Partial<HarnessInvocation> = {}): HarnessInvocation {
  return {
    cwd: '/work',
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    thinking: 'high',
    prompt: 'Fix it.',
    credentials: {api_key: 'sk-runtime-secret'},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function runtimeCredential(provider: string): Promise<unknown> {
  const options = modelRuntimeCreateMock.mock.calls[0]?.[0];
  return options?.credentials.read(provider) ?? Promise.resolve(undefined);
}

function customProvider(
  overrides: Partial<CustomModelProviderRuntimeConfigDto> = {},
): CustomModelProviderRuntimeConfigDto {
  return {
    api: 'openai-responses',
    base_url: 'https://models.example.test/v1',
    headers: [{name: 'x-plain', value: 'plain'}],
    secret_header_names: ['x-secret'],
    models: [{id: 'custom-gpt', label: 'Custom GPT'}],
    requires_api_key: false,
    ...overrides,
  };
}

function mcpBridge(overrides: Partial<IntegrationToolsBridge> = {}): IntegrationToolsBridge {
  return {
    name: 'shipfox_integration_tools',
    server: {} as IntegrationToolsBridge['server'],
    listTools: vi.fn(),
    callTool: vi.fn(),
    activateHttp: vi.fn().mockResolvedValue(new URL('http://127.0.0.1:43123/mcp')),
    close: vi.fn(),
    ...overrides,
  };
}

describe('piHarnessAdapter', () => {
  // Tracked so the temp dir is removed in afterEach even if an assertion throws first.
  let sessionDir: string | undefined;
  let priorGitConfigGlobal: string | undefined;

  beforeEach(() => {
    priorGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    delete process.env.GIT_CONFIG_GLOBAL;
    createAgentSessionMock.mockReset();
    createAgentSessionServicesMock.mockReset();
    findMock.mockReset();
    getAllMock.mockReset();
    hasConfiguredAuthMock.mockReset();
    registerProviderMock.mockReset();
    defineToolMock.mockClear();
    promptMock.mockReset();
    abortMock.mockReset();
    bindExtensionsMock.mockReset();
    getLastAssistantTextMock.mockReset();
    disposeMock.mockReset();
    extensionShutdownMock.mockReset();
    modelRuntimeCreateMock.mockReset();
    assertEgressAllowedMock.mockReset();
    assertEgressAllowedMock.mockResolvedValue(undefined);
    findMock.mockReturnValue({provider: 'anthropic', id: 'claude-opus-4-8'});
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);
    hasConfiguredAuthMock.mockReturnValue(true);
    modelRuntimeCreateMock.mockResolvedValue({
      getModel: findMock,
      getModels: getAllMock,
      hasConfiguredAuth: hasConfiguredAuthMock,
      registerProvider: registerProviderMock,
    });
    promptMock.mockResolvedValue(undefined);
    getLastAssistantTextMock.mockReturnValue(undefined);
    createAgentSessionServicesMock.mockResolvedValue(piServices());
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        dispose: disposeMock,
        extensionRunner: {emit: extensionShutdownMock},
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
      },
    });
  });

  afterEach(() => {
    if (priorGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = priorGitConfigGlobal;
    if (sessionDir) rmSync(sessionDir, {recursive: true, force: true});
    sessionDir = undefined;
  });

  it('resolves the configured model under the requested provider and runs the prompt', async () => {
    const model = {provider: 'openai', id: 'gpt-5.1'};
    findMock.mockReturnValue(model);

    const result = await piHarnessAdapter.run(invocation({provider: 'openai', model: 'gpt-5.1'}));

    expect(findMock).toHaveBeenCalledWith('openai', 'gpt-5.1');
    expect(createAgentSessionServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/work',
        resourceLoaderOptions: {additionalExtensionPaths: [piWebAccessDirectory]},
      }),
    );
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        services: expect.objectContaining({cwd: '/work'}),
        thinkingLevel: 'high',
        model,
      }),
    );
    expect(promptMock).toHaveBeenCalledWith(expect.stringContaining('Fix it.'));
    expect(result).toEqual({response: ''});
  });

  it('loads pi-web-access through the Pi resource loader without output tools by default', async () => {
    await piHarnessAdapter.run(invocation());

    expect(createAgentSessionServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLoaderOptions: {additionalExtensionPaths: [piWebAccessDirectory]},
      }),
    );
    expect(createAgentSessionMock.mock.calls[0]?.[0]).not.toHaveProperty('customTools');
  });

  it('configures eager loopback MCP proxy access in the job workspace', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const bridge = mcpBridge();
    let configPath = '';
    let config: unknown;
    createAgentSessionServicesMock.mockImplementation((options) => {
      configPath = options.extensionFlagValues.get('mcp-config');
      config = JSON.parse(readFileSync(configPath, 'utf8'));
      return piServices(sessionDir);
    });

    await piHarnessAdapter.run(invocation({cwd: sessionDir, mcpServers: [bridge]}));

    expect(bridge.activateHttp).toHaveBeenCalledTimes(1);
    expect(bindExtensionsMock).toHaveBeenCalledWith(expect.objectContaining({mode: 'print'}));
    expect(configPath).toMatch(`${sessionDir}/logs/pi-mcp-`);
    expect(config).toEqual({
      settings: {toolPrefix: 'none'},
      mcpServers: {
        shipfox_integration_tools: {
          url: 'http://127.0.0.1:43123/mcp',
          auth: false,
          lifecycle: 'eager',
          exposeResources: false,
        },
      },
    });
    expect(createAgentSessionServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLoaderOptions: {
          additionalExtensionPaths: [piWebAccessDirectory, piMcpAdapterDirectory],
        },
      }),
    );
    expect(extensionShutdownMock).toHaveBeenCalledWith({type: 'session_shutdown', reason: 'quit'});
    expect(disposeMock).toHaveBeenCalledAfter(extensionShutdownMock);
    expect(existsSync(configPath)).toBe(false);
  });

  it('aborts Pi while MCP extensions are binding', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const abortController = new AbortController();
    let resolveBinding: (() => void) | undefined;
    bindExtensionsMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveBinding = resolve;
        }),
    );

    const result = piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        signal: abortController.signal,
        mcpServers: [mcpBridge()],
      }),
    );
    await vi.waitFor(() => expect(bindExtensionsMock).toHaveBeenCalledTimes(1));

    abortController.abort();

    expect(abortMock).toHaveBeenCalledTimes(1);
    resolveBinding?.();
    await expect(result).rejects.toThrow('Agent step aborted during pi session creation');
  });

  it('fails before creating a Pi session when extension setup reports an error', async () => {
    createAgentSessionServicesMock.mockResolvedValue({
      ...piServices('/work', [{type: 'error', message: 'Unknown option: --mcp-config'}]),
    });

    const error = await piHarnessAdapter.run(invocation()).catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentHarnessUnavailableError);
    expect(error).toMatchObject({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      diagnostics: [{type: 'error', message: 'Unknown option: --mcp-config'}],
      environment: {
        cwd: '/work',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        extensionPaths: ['pi-web-access'],
      },
    });
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('reports the Pi extension path error before the diagnostic symptom', async () => {
    const piPathError = {
      path: piWebAccessDirectory,
      error: `Extension path does not exist: ${piWebAccessDirectory}`,
    };
    createAgentSessionServicesMock.mockResolvedValue({
      ...piServices('/work', [{type: 'error', message: 'Unknown option: --mcp-config'}]),
      resourceLoader: {
        getExtensions: () => ({extensions: [], errors: [piPathError]}),
      },
    });

    await expect(piHarnessAdapter.run(invocation())).rejects.toThrow(piPathError.error);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('registers the output tool for steps with declared outputs', async () => {
    const result = piHarnessAdapter.run(invocation({outputs: {summary: {type: 'string'}}}));

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');

    expect(createAgentSessionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        customTools: [expect.objectContaining({name: 'set_output'})],
      }),
    );
  });

  it('passes selected Pi tool names through unchanged', async () => {
    await piHarnessAdapter.run(invocation({tools: ['read', 'web_search', 'fetch_content']}));

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'web_search', 'fetch_content']}),
    );
  });

  it('adds the MCP proxy once when native tools are explicitly selected', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        mcpServers: [mcpBridge()],
        tools: ['read', 'mcp', 'web_search'],
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'mcp', 'web_search']}),
    );
  });

  it('appends the MCP proxy tool to an explicit tools list that omits it', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        mcpServers: [mcpBridge()],
        tools: ['read', 'web_search'],
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'web_search', 'mcp']}),
    );
  });

  it('omits the Pi tools option when no tools are selected', async () => {
    await piHarnessAdapter.run(invocation());

    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('tools');
  });

  it('disables default Pi tools for custom providers unless tools are selected', async () => {
    const model = {provider: 'local-ollama', id: 'llama'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'local-ollama',
        model: 'llama',
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({model, noTools: 'builtin'}),
    );
  });

  it('preserves custom-provider builtin suppression when MCP is configured', async () => {
    const model = {provider: 'local-ollama', id: 'llama'};
    findMock.mockReturnValue(model);
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));

    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        provider: 'local-ollama',
        model: 'llama',
        mcpServers: [mcpBridge()],
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({model, noTools: 'builtin'}),
    );
  });

  it('keeps output tools available for custom providers with declared outputs', async () => {
    const model = {provider: 'local-ollama', id: 'llama'};
    findMock.mockReturnValue(model);

    const result = piHarnessAdapter.run(
      invocation({
        provider: 'local-ollama',
        model: 'llama',
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
        outputs: {message: {type: 'string'}},
      }),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: message');
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        noTools: 'builtin',
        customTools: [expect.objectContaining({name: 'set_output'})],
      }),
    );
  });

  it('fails when Pi records an assistant error message', async () => {
    const messages = [
      {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: '400 model does not support tools',
      },
    ];
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages,
      },
    });
    getLastAssistantTextMock.mockReturnValue('partial');

    const result = piHarnessAdapter.run(invocation());

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      response: 'partial',
      message: '400 model does not support tools',
    });
  });

  it('preserves the final assistant response when required outputs stay missing', async () => {
    const model = {provider: 'anthropic', id: 'claude-opus-4-8'};
    findMock.mockReturnValue(model);
    getLastAssistantTextMock.mockReturnValue('final text without output');

    const result = piHarnessAdapter.run(invocation({outputs: {summary: {type: 'string'}}}));

    await expect(result).rejects.toMatchObject({
      message: 'Agent step finished without required outputs: summary',
      response: 'final text without output',
    });
    expect(promptMock).toHaveBeenCalledTimes(3);
  });

  it('returns the final assistant response and collected outputs after a correction turn', async () => {
    let customTools: Array<{
      execute: (toolCallId: string, params: {key: string; value: string}) => Promise<unknown>;
    }> = [];
    createAgentSessionMock.mockImplementation((options) => {
      customTools = options.customTools;
      return Promise.resolve({
        session: {
          prompt: promptMock,
          abort: abortMock,
          getLastAssistantText: getLastAssistantTextMock,
          messages: [],
        },
      });
    });
    promptMock.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      await customTools[0]?.execute('tool-1', {key: 'summary', value: 'done'});
    });
    getLastAssistantTextMock.mockReturnValue('final reply');

    const result = await piHarnessAdapter.run(invocation({outputs: {summary: {type: 'string'}}}));

    expect(promptMock).toHaveBeenCalledTimes(2);
    expect(promptMock).toHaveBeenLastCalledWith(expect.stringContaining('summary'));
    expect(result).toEqual({response: 'final reply', outputs: {summary: 'done'}});
  });

  it('injects runtime credentials into in-memory pi auth storage without persisting them', async () => {
    const model = {provider: 'openai', id: 'gpt-5.1'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'openai',
        model: 'gpt-5.1',
        credentials: {api_key: 'sk-runtime-secret'},
      }),
    );

    await expect(runtimeCredential('openai')).resolves.toEqual({
      type: 'api_key',
      key: 'sk-runtime-secret',
    });
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({model}));
  });

  it('registers a keyed custom provider with empty auth storage and merged headers', async () => {
    const model = {provider: 'ollama-workspace', id: 'custom-gpt'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'ollama-workspace',
        model: 'custom-gpt',
        credentials: {api_key: 'sk-custom', 'header:x-secret': 'secret-header'},
        customProvider: customProvider({requires_api_key: true}),
      }),
    );

    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'https://models.example.test/v1',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    await expect(runtimeCredential('ollama-workspace')).resolves.toBeUndefined();
    expect(registerProviderMock).toHaveBeenCalledWith(
      'ollama-workspace',
      expect.objectContaining({
        name: 'ollama-workspace',
        baseUrl: 'https://models.example.test/v1',
        api: 'openai-responses',
        apiKey: 'sk-custom',
        headers: {'x-plain': 'plain', 'x-secret': 'secret-header'},
      }),
    );
    expect(findMock).toHaveBeenCalledWith('ollama-workspace', 'custom-gpt');
    expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({model}));
  });

  it('rejects keyed custom providers when no api key is resolved', async () => {
    const result = piHarnessAdapter.run(
      invocation({
        provider: 'workspace-models',
        model: 'custom-gpt',
        credentials: {},
        customProvider: customProvider({requires_api_key: true}),
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentConfigError',
      agentConfigIssue: 'credentials_invalid',
    });
    expect(registerProviderMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('rejects keyed custom providers when an empty api key is resolved', async () => {
    const result = piHarnessAdapter.run(
      invocation({
        provider: 'workspace-models',
        model: 'custom-gpt',
        credentials: {api_key: ''},
        customProvider: customProvider({requires_api_key: true}),
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentConfigError',
      agentConfigIssue: 'credentials_invalid',
    });
    expect(registerProviderMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('registers keyless custom providers with a placeholder api key', async () => {
    findMock.mockReturnValue({provider: 'local-ollama', id: 'llama'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'local-ollama',
        model: 'llama',
        credentials: {},
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'local-ollama',
      expect.objectContaining({
        apiKey: 'shipfox-keyless-custom-provider-placeholder',
      }),
    );
  });

  it('treats an empty custom provider api key as keyless', async () => {
    findMock.mockReturnValue({provider: 'local-ollama', id: 'llama'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'local-ollama',
        model: 'llama',
        credentials: {api_key: ''},
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'local-ollama',
      expect.objectContaining({
        apiKey: 'shipfox-keyless-custom-provider-placeholder',
      }),
    );
  });

  it('skips missing secret headers when rebuilding custom provider headers', async () => {
    findMock.mockReturnValue({provider: 'custom', id: 'custom-gpt'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'custom-gpt',
        credentials: {api_key: 'sk-custom'},
        customProvider: customProvider({secret_header_names: ['x-secret', 'x-missing']}),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'custom',
      expect.objectContaining({
        headers: {'x-plain': 'plain'},
      }),
    );
  });

  it('skips empty secret headers when rebuilding custom provider headers', async () => {
    findMock.mockReturnValue({provider: 'custom', id: 'custom-gpt'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'custom-gpt',
        credentials: {api_key: 'sk-custom', 'header:x-secret': ''},
        customProvider: customProvider({secret_header_names: ['x-secret']}),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'custom',
      expect.objectContaining({
        headers: {'x-plain': 'plain'},
      }),
    );
  });

  it('lets secret headers override plaintext headers with the same name', async () => {
    findMock.mockReturnValue({provider: 'custom', id: 'custom-gpt'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'custom-gpt',
        credentials: {api_key: 'sk-custom', 'header:x-auth': 'secret-auth'},
        customProvider: customProvider({
          headers: [{name: 'x-auth', value: 'plain-auth'}],
          secret_header_names: ['x-auth'],
        }),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'custom',
      expect.objectContaining({
        headers: {'x-auth': 'secret-auth'},
      }),
    );
  });

  it.each([
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
  ] as const)('registers custom provider api "%s"', async (api) => {
    findMock.mockReturnValue({provider: 'custom', id: 'custom-gpt'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'custom-gpt',
        customProvider: customProvider({api}),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith('custom', expect.objectContaining({api}));
  });

  it('synthesizes custom provider model defaults from shared constants', async () => {
    findMock.mockReturnValue({provider: 'custom', id: 'custom-gpt'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'custom-gpt',
        customProvider: customProvider(),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'custom',
      expect.objectContaining({
        models: [
          {
            id: 'custom-gpt',
            name: 'Custom GPT',
            api: 'openai-responses',
            reasoning: DEFAULT_CUSTOM_MODEL_REASONING,
            input: DEFAULT_CUSTOM_MODEL_INPUT_IMAGE ? ['text', 'image'] : ['text'],
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
            contextWindow: DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
            maxTokens: DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
          },
        ],
      }),
    );
  });

  it('passes explicit custom provider model metadata through to pi', async () => {
    findMock.mockReturnValue({provider: 'custom', id: 'vision-model'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'custom',
        model: 'vision-model',
        customProvider: customProvider({
          models: [
            {
              id: 'vision-model',
              label: 'Vision Model',
              context_window: 64_000,
              max_output_tokens: 8_192,
              input_image: true,
              reasoning: true,
            },
          ],
        }),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'custom',
      expect.objectContaining({
        models: [
          {
            id: 'vision-model',
            name: 'Vision Model',
            api: 'openai-responses',
            reasoning: true,
            input: ['text', 'image'],
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
            contextWindow: 64_000,
            maxTokens: 8_192,
          },
        ],
      }),
    );
  });

  it('throws an AgentConfigError when the egress guard blocks a custom provider', async () => {
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('private-network', '10.0.0.12'),
    );

    await expect(
      piHarnessAdapter.run(
        invocation({
          provider: 'local-ollama',
          model: 'llama',
          credentials: {},
          customProvider: customProvider({base_url: 'http://10.0.0.12/v1'}),
        }),
      ),
    ).rejects.toThrow(
      new AgentConfigError(
        'Custom model provider endpoint blocked by egress policy: private-network (10.0.0.12).',
        'step_config_invalid',
      ),
    );
    expect(registerProviderMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError when pi rejects a custom provider descriptor', async () => {
    registerProviderMock.mockImplementation(() => {
      throw new Error('"apiKey" or "oauth" is required when defining models');
    });

    await expect(
      piHarnessAdapter.run(
        invocation({
          provider: 'custom',
          model: 'custom-gpt',
          customProvider: customProvider(),
        }),
      ),
    ).rejects.toThrow(
      new AgentConfigError(
        'Custom model provider "custom" is invalid: "apiKey" or "oauth" is required when defining models',
        'step_config_invalid',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('maps Azure runtime credentials into pi provider env', async () => {
    const model = {provider: 'azure-openai-responses', id: 'gpt-5.5-pro'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'azure-openai-responses',
        model: 'gpt-5.5-pro',
        credentials: {
          endpoint: 'https://shipfox.openai.azure.com',
          api_key: 'sk-azure-secret',
        },
      }),
    );

    await expect(runtimeCredential('azure-openai-responses')).resolves.toEqual({
      type: 'api_key',
      key: 'sk-azure-secret',
      env: {AZURE_OPENAI_BASE_URL: 'https://shipfox.openai.azure.com'},
    });
  });

  it('maps Cloudflare runtime credentials into pi provider env', async () => {
    const model = {provider: 'cloudflare-ai-gateway', id: 'claude-opus-4-8'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'cloudflare-ai-gateway',
        model: 'claude-opus-4-8',
        credentials: {
          api_key: 'cf-secret',
          account_id: 'account-1',
          gateway_id: 'gateway-1',
        },
      }),
    );

    await expect(runtimeCredential('cloudflare-ai-gateway')).resolves.toEqual({
      type: 'api_key',
      key: 'cf-secret',
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-1',
        CLOUDFLARE_GATEWAY_ID: 'gateway-1',
      },
    });
  });

  it('throws an AgentConfigError when runtime credentials have no API key', async () => {
    await expect(
      piHarnessAdapter.run(invocation({provider: 'openai', credentials: {account_id: 'acct-1'}})),
    ).rejects.toThrow(
      new AgentConfigError(
        'Runtime credentials for provider "openai" are missing "api_key".',
        'credentials_invalid',
      ),
    );
    expect(findMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError when provider-specific runtime fields are missing', async () => {
    await expect(
      piHarnessAdapter.run(
        invocation({
          provider: 'cloudflare-ai-gateway',
          credentials: {api_key: 'cf-secret', account_id: 'account-1'},
        }),
      ),
    ).rejects.toThrow(
      new AgentConfigError(
        'Runtime credentials for provider "cloudflare-ai-gateway" are missing "gateway_id".',
        'credentials_invalid',
      ),
    );
    expect(findMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('forwards each persisted session entry to onSessionEntry in order', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-run-agent-'));
    const sessionFile = join(sessionDir, 'session.jsonl');
    // pi persists entries to the session file during the turn; the final read on completion
    // forwards everything written before the prompt resolved.
    promptMock.mockImplementation(() => {
      appendFileSync(sessionFile, '{"type":"session"}\n{"type":"message","id":"a"}\n');
      return Promise.resolve();
    });
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
        sessionFile,
      },
    });
    const entries: string[] = [];

    await piHarnessAdapter.run(invocation({onSessionEntry: (line) => entries.push(line)}));

    expect(entries).toEqual(['{"type":"session"}', '{"type":"message","id":"a"}']);
  });

  it('skips forwarding when the session is not persisted (no session file)', async () => {
    const entries: string[] = [];

    await piHarnessAdapter.run(invocation({onSessionEntry: (line) => entries.push(line)}));

    expect(entries).toEqual([]);
  });

  it('sets GIT_CONFIG_GLOBAL for the prompt and restores the previous value', async () => {
    process.env.GIT_CONFIG_GLOBAL = '/runner/base.gitconfig';
    promptMock.mockImplementation(() => {
      expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/job/git-cred.config');
      return Promise.resolve();
    });

    await piHarnessAdapter.run(invocation({gitConfigGlobal: '/runner/job/git-cred.config'}));

    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/base.gitconfig');
  });

  it('deletes GIT_CONFIG_GLOBAL after the prompt when it was previously unset', async () => {
    promptMock.mockImplementation(() => {
      expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/job/git-cred.config');
      return Promise.resolve();
    });

    await piHarnessAdapter.run(invocation({gitConfigGlobal: '/runner/job/git-cred.config'}));

    expect(process.env.GIT_CONFIG_GLOBAL).toBeUndefined();
  });

  it('restores GIT_CONFIG_GLOBAL when the prompt throws', async () => {
    process.env.GIT_CONFIG_GLOBAL = '/runner/base.gitconfig';
    promptMock.mockImplementation(() => {
      expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/job/git-cred.config');
      return Promise.reject(new Error('prompt failed'));
    });

    await expect(
      piHarnessAdapter.run(invocation({gitConfigGlobal: '/runner/job/git-cred.config'})),
    ).rejects.toThrow('prompt failed');

    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/base.gitconfig');
  });

  it('restores GIT_CONFIG_GLOBAL synchronously when the signal aborts mid-prompt', async () => {
    const ac = new AbortController();
    process.env.GIT_CONFIG_GLOBAL = '/runner/base.gitconfig';
    let resolvePrompt: () => void = () => undefined;
    promptMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    const promise = piHarnessAdapter.run(
      invocation({signal: ac.signal, gitConfigGlobal: '/runner/job/git-cred.config'}),
    );
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalled());
    ac.abort();

    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/runner/base.gitconfig');
    resolvePrompt();
    await expect(promise).rejects.toThrow('Agent step aborted');
  });

  it('throws an AgentConfigError naming the provider when it is unknown', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);

    await expect(
      piHarnessAdapter.run(invocation({provider: 'bogus', model: 'gpt-5.1'})),
    ).rejects.toThrow(
      new AgentConfigError(
        'Unknown provider "bogus" for agent step. ' +
          'Known providers are pi built-ins plus any from models.json.',
        'provider_unsupported',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError with a did-you-mean hint when the model is on another provider', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([
      {provider: 'anthropic', id: 'claude-opus-4-8'},
      {provider: 'openai', id: 'gpt-5.1'},
    ]);

    await expect(
      piHarnessAdapter.run(invocation({provider: 'anthropic', model: 'gpt-5.1'})),
    ).rejects.toThrow(
      new AgentConfigError(
        'Model "gpt-5.1" is not available for provider "anthropic". ' +
          'Did you mean to set provider: openai?',
        'model_unavailable',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError without a hint when no provider carries the model', async () => {
    findMock.mockReturnValue(undefined);
    getAllMock.mockReturnValue([{provider: 'anthropic', id: 'claude-opus-4-8'}]);

    await expect(
      piHarnessAdapter.run(invocation({provider: 'anthropic', model: 'gpt-5.1'})),
    ).rejects.toThrow(
      new AgentConfigError(
        'Model "gpt-5.1" is not available for provider "anthropic".',
        'model_unavailable',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('throws an AgentConfigError when the provider has no configured workspace credentials', async () => {
    findMock.mockReturnValue({provider: 'openai', id: 'gpt-5.1'});
    hasConfiguredAuthMock.mockReturnValue(false);

    await expect(
      piHarnessAdapter.run(invocation({provider: 'openai', model: 'gpt-5.1'})),
    ).rejects.toThrow(
      new AgentConfigError(
        'No credentials configured for provider "openai". ' +
          'Verify the provider is configured for this workspace.',
        'provider_not_configured',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('aborts the pi session when the signal fires', async () => {
    const ac = new AbortController();
    let resolvePrompt: () => void = () => undefined;
    promptMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        }),
    );

    const promise = piHarnessAdapter.run(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(promptMock).toHaveBeenCalled());
    ac.abort();

    expect(abortMock).toHaveBeenCalledTimes(1);
    resolvePrompt();
    await expect(promise).rejects.toThrow('Agent step aborted');
  });

  it('aborts the session and skips the prompt when the signal fires during session creation', async () => {
    const ac = new AbortController();
    let resolveCreate: (value: {session: unknown}) => void = () => undefined;
    createAgentSessionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const promise = piHarnessAdapter.run(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(createAgentSessionMock).toHaveBeenCalled());
    ac.abort();
    resolveCreate({
      session: {
        prompt: promptMock,
        abort: abortMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
      },
    });

    await expect(promise).rejects.toThrow('aborted');
    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(promptMock).not.toHaveBeenCalled();
  });

  it('does not run pi when the signal is already aborted on entry', async () => {
    const ac = new AbortController();
    ac.abort();

    await expect(piHarnessAdapter.run(invocation({signal: ac.signal}))).rejects.toThrow('aborted');
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });
});
