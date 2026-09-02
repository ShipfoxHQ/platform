const piExtensionTestState = vi.hoisted(() => ({
  resolver: undefined as ((specifier: string) => string) | undefined,
}));

const {
  createAgentSessionMock,
  createAgentSessionServicesMock,
  sessionManagerCreateMock,
  sessionManagerOpenMock,
  sessionManagerForkFromMock,
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
  getActiveToolNamesMock,
  setActiveToolsByNameMock,
  disposeMock,
  extensionShutdownMock,
} = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  createAgentSessionServicesMock: vi.fn(),
  sessionManagerCreateMock: vi.fn(() => ({})),
  sessionManagerOpenMock: vi.fn(() => ({
    getHeader: () => ({type: 'session'}),
    getEntries: () => [{type: 'message'}],
  })),
  sessionManagerForkFromMock: vi.fn(() => ({})),
  findMock: vi.fn(),
  getAllMock: vi.fn(),
  hasConfiguredAuthMock: vi.fn(),
  registerProviderMock: vi.fn(),
  defineToolMock: vi.fn((tool) => tool),
  promptMock: vi.fn(),
  abortMock: vi.fn(),
  bindExtensionsMock: vi.fn(),
  getLastAssistantTextMock: vi.fn(),
  getActiveToolNamesMock: vi.fn(),
  setActiveToolsByNameMock: vi.fn(),
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

const {isPiExtensionAvailableMock} = vi.hoisted(() => ({
  isPiExtensionAvailableMock: vi.fn(),
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSessionFromServices: createAgentSessionMock,
  createAgentSessionServices: createAgentSessionServicesMock,
  defineTool: defineToolMock,
  ModelRuntime: {
    create: modelRuntimeCreateMock,
  },
  SessionManager: {
    create: sessionManagerCreateMock,
    open: sessionManagerOpenMock,
    forkFrom: sessionManagerForkFromMock,
  },
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

vi.mock('#core/pi-extensions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/pi-extensions.js')>();
  return {
    ...actual,
    isPiExtensionAvailable: isPiExtensionAvailableMock,
    piExtensionDirectories: (params: Parameters<typeof actual.piExtensionDirectories>[0]) =>
      piExtensionTestState.resolver === undefined
        ? actual.piExtensionDirectories(params)
        : actual.piExtensionDirectories({...params, resolve: piExtensionTestState.resolver}),
  };
});

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, isAbsolute, join} from 'node:path';
import type {ToolDefinition} from '@earendil-works/pi-coding-agent';
import {
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  AgentConfigError,
  AgentHarnessUnavailableError,
  AgentInvocationError,
  AgentSessionUnavailableError,
} from '#core/errors.js';
import type {HarnessInvocation} from '#core/harness.js';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';
import {piHarnessAdapter} from '#core/pi-adapter.js';
import {piExtensionDirectories} from '#core/pi-extensions.js';
import {PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME} from '#core/pi-tool-error-normalizer.js';
import {PI_TOOL_SVG_NORMALIZER_EXTENSION_NAME} from '#core/pi-tool-svg-normalizer.js';

function extensionDirectory(packageName: string): string {
  const [directory] = piExtensionDirectories({packageNames: [packageName]});
  if (directory === undefined) throw new Error(`Missing resolved directory for ${packageName}`);
  return directory;
}

const piWebAccessDirectory = extensionDirectory('pi-web-access');
const piMcpAdapterDirectory = extensionDirectory('pi-mcp-adapter');

function piServices(
  cwd = '/work',
  diagnostics: Array<{type: string; message: string}> = [],
  loadedDirectories: readonly string[] = [piWebAccessDirectory, piMcpAdapterDirectory],
  extensionErrors: Array<{path: string; error: string}> = [],
) {
  return {
    cwd,
    diagnostics,
    resourceLoader: {
      getExtensions: () => ({
        extensions: loadedDirectories.map((directory) => ({resolvedPath: `${directory}/index.ts`})),
        errors: extensionErrors,
      }),
    },
  };
}

function expectResolvedExtensionPaths(
  paths: readonly string[] | undefined,
  expectedNames: readonly string[],
  workspace: string,
): void {
  expect(paths).toBeDefined();
  if (paths === undefined) return;

  expect(paths.map((path) => basename(path))).toEqual(expectedNames);
  for (const path of paths) {
    expect(isAbsolute(path)).toBe(true);
    expect(statSync(path).isDirectory()).toBe(true);
    expect(path.startsWith(workspace)).toBe(false);
  }
}

function invocation(overrides: Partial<HarnessInvocation> = {}): HarnessInvocation {
  return {
    cwd: '/work',
    agentStateDir: '/runner-agent/job-1',
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
    listTools: vi.fn().mockResolvedValue({tools: []}),
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
    sessionManagerCreateMock.mockReset();
    sessionManagerCreateMock.mockReturnValue({});
    sessionManagerOpenMock.mockReset();
    sessionManagerOpenMock.mockReturnValue({
      getHeader: () => ({type: 'session'}),
      getEntries: () => [{type: 'message'}],
    });
    sessionManagerForkFromMock.mockReset();
    sessionManagerForkFromMock.mockReturnValue({});
    findMock.mockReset();
    getAllMock.mockReset();
    hasConfiguredAuthMock.mockReset();
    registerProviderMock.mockReset();
    defineToolMock.mockClear();
    promptMock.mockReset();
    abortMock.mockReset();
    bindExtensionsMock.mockReset();
    getLastAssistantTextMock.mockReset();
    getActiveToolNamesMock.mockReset();
    setActiveToolsByNameMock.mockReset();
    disposeMock.mockReset();
    extensionShutdownMock.mockReset();
    modelRuntimeCreateMock.mockReset();
    piExtensionTestState.resolver = undefined;
    assertEgressAllowedMock.mockReset();
    assertEgressAllowedMock.mockResolvedValue(undefined);
    isPiExtensionAvailableMock.mockReturnValue(true);
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
    getActiveToolNamesMock.mockReturnValue(['read', 'bash', 'edit', 'write']);
    createAgentSessionServicesMock.mockResolvedValue(piServices());
    createAgentSessionMock.mockResolvedValue({
      session: {
        agent: {},
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        dispose: disposeMock,
        extensionRunner: {emit: extensionShutdownMock},
        getLastAssistantText: getLastAssistantTextMock,
        getActiveToolNames: getActiveToolNamesMock,
        setActiveToolsByName: setActiveToolsByNameMock,
        messages: [],
      },
    });
  });

  afterEach(() => {
    if (priorGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = priorGitConfigGlobal;
    if (sessionDir) rmSync(sessionDir, {recursive: true, force: true});
    sessionDir = undefined;
    vi.restoreAllMocks();
  });

  it('resolves the configured model and forwards max thinking to Pi', async () => {
    const model = {provider: 'openai', id: 'gpt-5.1'};
    findMock.mockReturnValue(model);

    const result = await piHarnessAdapter.run(
      invocation({provider: 'openai', model: 'gpt-5.1', thinking: 'max'}),
    );

    expect(findMock).toHaveBeenCalledWith('openai', 'gpt-5.1');
    expectResolvedExtensionPaths(
      createAgentSessionServicesMock.mock.calls[0]?.[0].resourceLoaderOptions
        .additionalExtensionPaths,
      ['pi-web-access'],
      '/work',
    );
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        services: expect.objectContaining({cwd: '/work'}),
        thinkingLevel: 'max',
        model,
      }),
    );
    expect(promptMock).toHaveBeenCalledWith(expect.stringContaining('Fix it.'));
    expect(result).toEqual({response: ''});
  });

  it('loads pi-web-access through the Pi resource loader without output tools by default', async () => {
    await piHarnessAdapter.run(invocation());

    expectResolvedExtensionPaths(
      createAgentSessionServicesMock.mock.calls[0]?.[0].resourceLoaderOptions
        .additionalExtensionPaths,
      ['pi-web-access'],
      '/work',
    );
    expect(createAgentSessionMock.mock.calls[0]?.[0]).not.toHaveProperty('customTools');
  });

  it('binds the inline image normalizer for sessions without MCP', async () => {
    await piHarnessAdapter.run(invocation());

    const options = createAgentSessionServicesMock.mock.calls[0]?.[0];
    expect(options.resourceLoaderOptions.extensionFactories).toEqual([
      expect.objectContaining({
        name: PI_TOOL_SVG_NORMALIZER_EXTENSION_NAME,
      }),
    ]);
    expect(bindExtensionsMock).toHaveBeenCalledTimes(1);
    expect(bindExtensionsMock).toHaveBeenCalledWith(expect.objectContaining({mode: 'print'}));
  });

  it('keeps Pi built-ins available when pi-web-access is unavailable', async () => {
    isPiExtensionAvailableMock.mockImplementation(
      ({packageName}: {packageName: string}) => packageName !== 'pi-web-access',
    );

    await piHarnessAdapter.run(invocation());

    expect(createAgentSessionServicesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceLoaderOptions: expect.objectContaining({additionalExtensionPaths: []}),
      }),
    );
    expect(createAgentSessionMock).toHaveBeenCalled();
  });

  it('configures eager loopback MCP direct and proxy access in the runner job agent-state directory', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const agentStateDir = join(sessionDir, 'runner-agent');
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'linear_main__get_issue',
            description: 'Read a Linear issue.',
            inputSchema: {type: 'object', properties: {id: {type: 'string'}}},
          },
        ],
      }),
    });
    let configPath = '';
    let config: unknown;
    let argvDuringServiceCreation: readonly string[] | undefined;
    const originalArgv = process.argv.slice();
    process.argv.splice(
      0,
      process.argv.length,
      'node',
      'runner',
      '--mcp-config',
      '/tmp/old-mcp.json',
      'serve',
      '--mcp-config=/tmp/equals-mcp.json',
    );
    createAgentSessionServicesMock.mockImplementation((options) => {
      configPath = options.extensionFlagValues.get('mcp-config');
      config = JSON.parse(readFileSync(configPath, 'utf8'));
      argvDuringServiceCreation = process.argv.slice();
      return piServices(sessionDir);
    });

    try {
      await piHarnessAdapter.run(
        invocation({
          cwd: sessionDir,
          agentStateDir,
          mcpServers: [bridge],
          toolSurface: 'discovery',
        }),
      );
    } finally {
      process.argv.splice(0, process.argv.length, ...originalArgv);
    }

    expect(bridge.activateHttp).toHaveBeenCalledTimes(1);
    expect(bridge.listTools).toHaveBeenCalledTimes(1);
    expect(bindExtensionsMock).toHaveBeenCalledWith(expect.objectContaining({mode: 'print'}));
    expect(configPath).toMatch(`${agentStateDir}/pi-mcp-`);
    expect(argvDuringServiceCreation).toEqual([
      'node',
      'runner',
      '--mcp-config',
      configPath,
      'serve',
      '--mcp-config=/tmp/equals-mcp.json',
    ]);
    expect(process.argv).toEqual(originalArgv);
    expect(sessionManagerCreateMock).toHaveBeenCalledWith(
      sessionDir,
      join(agentStateDir, 'agent-sessions'),
    );
    expect(config).toEqual({
      settings: {toolPrefix: 'none'},
      mcpServers: {
        shipfox_integration_tools: {
          url: 'http://127.0.0.1:43123/mcp',
          auth: false,
          lifecycle: 'eager',
          directTools: true,
          exposeResources: false,
        },
      },
    });
    expectResolvedExtensionPaths(
      createAgentSessionServicesMock.mock.calls[0]?.[0].resourceLoaderOptions
        .additionalExtensionPaths,
      ['pi-web-access', 'pi-mcp-adapter'],
      sessionDir,
    );
    expect(
      createAgentSessionServicesMock.mock.calls[0]?.[0].resourceLoaderOptions.extensionFactories,
    ).toEqual([
      expect.objectContaining({
        name: PI_TOOL_ERROR_NORMALIZER_EXTENSION_NAME,
      }),
      expect.objectContaining({
        name: PI_TOOL_SVG_NORMALIZER_EXTENSION_NAME,
      }),
    ]);
    expect(extensionShutdownMock).toHaveBeenCalledWith({type: 'session_shutdown', reason: 'quit'});
    expect(disposeMock).toHaveBeenCalledAfter(extensionShutdownMock);
    expect(existsSync(configPath)).toBe(false);
  });

  it('serializes Pi MCP config argv setup across concurrent sessions', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const firstAgentStateDir = join(sessionDir, 'first-agent');
    const secondAgentStateDir = join(sessionDir, 'second-agent');
    const originalArgv = process.argv.slice();
    let releaseFirstService!: () => void;
    const firstServiceReleased = new Promise<void>((resolve) => {
      releaseFirstService = resolve;
    });
    const observed: Array<{configPath: string; argv: readonly string[]}> = [];
    let startFirstService!: () => void;
    const firstServiceStarted = new Promise<void>((resolve) => {
      startFirstService = resolve;
    });
    createAgentSessionServicesMock.mockImplementation(async (options) => {
      observed.push({
        configPath: options.extensionFlagValues.get('mcp-config'),
        argv: process.argv.slice(),
      });
      if (observed.length === 1) {
        startFirstService();
        await firstServiceReleased;
      }
      return piServices();
    });

    const first = piHarnessAdapter.run(
      invocation({
        agentStateDir: firstAgentStateDir,
        mcpServers: [mcpBridge()],
        toolSurface: 'discovery',
      }),
    );
    await firstServiceStarted;

    const second = piHarnessAdapter.run(
      invocation({
        agentStateDir: secondAgentStateDir,
        mcpServers: [mcpBridge()],
        toolSurface: 'discovery',
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(observed).toHaveLength(1);

    releaseFirstService();
    await Promise.all([first, second]);

    expect(observed).toHaveLength(2);
    expect(observed[0]?.argv).toContain(observed[0]?.configPath);
    expect(observed[1]?.argv).toContain(observed[1]?.configPath);
    expect(observed[0]?.configPath).not.toBe(observed[1]?.configPath);
    expect(process.argv).toEqual(originalArgv);
  });

  it('fails closed before session creation when direct-tool metadata is unavailable', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const failingBridge = mcpBridge({
      name: 'unavailable_server',
      listTools: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
    });
    const healthyBridge = mcpBridge({
      name: 'healthy_server',
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'healthy_tool', inputSchema: {type: 'object'}}],
      }),
    });
    const result = piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [failingBridge, healthyBridge],
        tools: ['read'],
      }),
    );

    const error = await result.catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentInvocationError);
    expect(error).toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_catalog_unavailable',
      message:
        'Pi integration tool catalog unavailable for "unavailable_server": gateway unavailable',
    });
    expect(healthyBridge.listTools).toHaveBeenCalledTimes(1);
    expect(createAgentSessionServicesMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('propagates aborts that occur during direct-tool metadata discovery', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const abortController = new AbortController();
    const bridge = mcpBridge({
      listTools: vi.fn(
        ({signal}: {signal: AbortSignal}) =>
          new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {once: true});
          }),
      ),
    });

    const result = piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        signal: abortController.signal,
        mcpServers: [bridge],
      }),
    );
    await vi.waitFor(() => expect(bridge.listTools).toHaveBeenCalledTimes(1));

    abortController.abort();

    await expect(result).rejects.toBe(abortController.signal.reason);
    expect(createAgentSessionServicesMock).not.toHaveBeenCalled();
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
        agentStateDir: join(sessionDir, 'runner-agent'),
        signal: abortController.signal,
        mcpServers: [mcpBridge()],
        toolSurface: 'discovery',
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
      resourceLoader: {
        getExtensions: () => ({
          extensions: [{resolvedPath: `${piWebAccessDirectory}/index.ts`}],
          errors: [],
        }),
      },
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
        resolvedExtensionPaths: [`${piWebAccessDirectory}/index.ts`],
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

    const error = await piHarnessAdapter.run(invocation()).catch((caught) => caught);
    expect(error).toBeInstanceOf(AgentHarnessUnavailableError);
    expect(error).toMatchObject({
      message: `Pi extension setup failed: Unknown option: --mcp-config; ${piPathError.error}`,
      resourceLoaderErrors: [piPathError],
    });
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('fails when Pi silently loads no requested extension', async () => {
    createAgentSessionServicesMock.mockResolvedValue(piServices('/work', [], []));

    await expect(piHarnessAdapter.run(invocation())).rejects.toThrow(piWebAccessDirectory);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('includes Pi extension errors in the setup failure', async () => {
    const piPathError = {
      path: piWebAccessDirectory,
      error: `Extension path does not exist: ${piWebAccessDirectory}`,
    };
    createAgentSessionServicesMock.mockResolvedValue(piServices('/work', [], [], [piPathError]));

    await expect(piHarnessAdapter.run(invocation())).rejects.toThrow(piPathError.error);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('names only the Pi extension directory that was not loaded', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    createAgentSessionServicesMock.mockResolvedValue(
      piServices('/work', [], [piWebAccessDirectory]),
    );

    const error = await piHarnessAdapter
      .run(
        invocation({
          cwd: sessionDir,
          agentStateDir: join(sessionDir, 'runner-agent'),
          mcpServers: [mcpBridge()],
          toolSurface: 'discovery',
        }),
      )
      .catch((caught) => caught);

    expect(error.message).toContain(piMcpAdapterDirectory);
    expect(error.message).not.toContain(piWebAccessDirectory);
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('wraps resolver failures as harness-unavailable and cleans the MCP temp directory', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const resolverError = new Error('Cannot find package entry');
    piExtensionTestState.resolver = () => {
      throw resolverError;
    };

    const error = await piHarnessAdapter
      .run(
        invocation({
          cwd: sessionDir,
          agentStateDir: join(sessionDir, 'runner-agent'),
          mcpServers: [mcpBridge()],
          toolSurface: 'discovery',
        }),
      )
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(AgentHarnessUnavailableError);
    expect(error).toMatchObject({
      message: expect.stringContaining('pi-web-access'),
      environment: {extensionPaths: ['pi-web-access', 'pi-mcp-adapter']},
    });
    expect(createAgentSessionServicesMock).not.toHaveBeenCalled();
    expect(readdirSync(join(sessionDir, 'runner-agent'))).toEqual([]);
  });

  it('registers the output tool for steps with declared outputs', async () => {
    const schema = {type: 'array', items: {type: 'string'}};
    const result = piHarnessAdapter.run(invocation({outputs: {findings: {type: 'json', schema}}}));

    await expect(result).rejects.toThrow('Agent step finished without required outputs: findings');

    expect(createAgentSessionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        customTools: [
          expect.objectContaining({
            name: 'set_output',
            promptGuidelines: [
              'Call set_output({key: "<output-key>", value: "<value>"}) directly for each required workflow output; do not call it through mcp. The exact key, value encoding, and JSON Schema for each are in the task prompt.',
            ],
          }),
        ],
      }),
    );
    expect(promptMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(JSON.stringify(schema, null, 2)),
    );
  });

  it('keeps runner-managed tools enabled when Pi tools are explicitly selected', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const result = piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        tools: ['read'],
        mcpServers: [mcpBridge()],
        outputs: {summary: {type: 'string'}},
      }),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');
    expect(createAgentSessionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        tools: ['read', 'set_output'],
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
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [mcpBridge()],
        toolSurface: 'discovery',
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
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [mcpBridge()],
        tools: ['read', 'web_search'],
        toolSurface: 'discovery',
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'web_search', 'mcp']}),
    );
  });

  it('adds discovered integration tools to an explicit Pi tool list', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {name: 'linear_main__get_issue', inputSchema: {type: 'object'}},
          {name: 'linear_main__save_comment', inputSchema: {type: 'object'}},
        ],
      }),
      callTool: vi.fn().mockResolvedValue({content: [{type: 'text', text: 'issue'}]}),
    });

    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [bridge],
        tools: ['read'],
        requestedIntegrationTools: [{connectionSlug: 'linear-main', toolId: 'get_issue'}],
      }),
    );

    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        tools: ['read', 'linear_main__get_issue'],
        customTools: [
          expect.objectContaining({
            name: 'linear_main__get_issue',
            parameters: {
              type: 'object',
            },
          }),
        ],
      }),
    );
    const directTool = options.customTools[0];
    expect(directTool).toBeDefined();
    if (directTool === undefined) return;

    await directTool.execute(
      'call-1',
      {id: 'ENG-878'},
      new AbortController().signal,
      undefined,
      {} as never,
    );
    expect(bridge.callTool).toHaveBeenCalledWith('linear_main__get_issue', {id: 'ENG-878'});
  });

  it('keeps strict direct tool definitions stable across cold and warm sessions', async () => {
    const schema = {
      type: 'object',
      properties: {id: {type: 'string'}},
      required: ['id'],
    };
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {name: 'linear_main__get_issue', description: 'Read an issue.', inputSchema: schema},
        ],
      }),
    });

    await piHarnessAdapter.run(invocation({mcpServers: [bridge]}));
    await piHarnessAdapter.run(invocation({mcpServers: [bridge]}));

    const first = createAgentSessionMock.mock.calls[0]?.[0];
    const second = createAgentSessionMock.mock.calls[1]?.[0];
    expect(first).toEqual(
      expect.objectContaining({
        customTools: [
          expect.objectContaining({name: 'linear_main__get_issue', parameters: schema}),
        ],
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        customTools: [
          expect.objectContaining({name: 'linear_main__get_issue', parameters: schema}),
        ],
      }),
    );
    expect(setActiveToolsByNameMock).toHaveBeenNthCalledWith(1, [
      'linear_main__get_issue',
      'read',
      'bash',
      'edit',
      'write',
    ]);
    expect(setActiveToolsByNameMock).toHaveBeenNthCalledWith(2, [
      'linear_main__get_issue',
      'read',
      'bash',
      'edit',
      'write',
    ]);
  });

  it('places set_output before direct integration tools in the provider surface', async () => {
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'linear_main__get_issue', inputSchema: {type: 'object'}}],
      }),
    });

    const result = piHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        tools: ['read'],
        outputs: {summary: {type: 'string'}},
      }),
    );
    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');

    expect(createAgentSessionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        tools: ['read', 'set_output', 'linear_main__get_issue'],
        customTools: [
          expect.objectContaining({name: 'set_output'}),
          expect.objectContaining({name: 'linear_main__get_issue'}),
        ],
      }),
    );
  });

  it('places SDK output tools before discovery extension tools', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    getActiveToolNamesMock.mockReturnValue([
      'read',
      'bash',
      'edit',
      'write',
      'mcp',
      'linear_main__get_issue',
    ]);
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'linear_main__get_issue', inputSchema: {type: 'object'}}],
      }),
    });

    const result = piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [bridge],
        toolSurface: 'discovery',
        outputs: {summary: {type: 'string'}},
      }),
    );
    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');

    expect(setActiveToolsByNameMock).toHaveBeenCalledWith([
      'set_output',
      'read',
      'bash',
      'edit',
      'write',
      'mcp',
      'linear_main__get_issue',
    ]);
  });

  it('completes mixed direct integration and required-output turns', async () => {
    let customTools: ToolDefinition[] = [];
    createAgentSessionMock.mockImplementation((options) => {
      customTools = options.customTools;
      return Promise.resolve({
        session: {
          prompt: promptMock,
          abort: abortMock,
          bindExtensions: bindExtensionsMock,
          dispose: disposeMock,
          extensionRunner: {emit: extensionShutdownMock},
          getLastAssistantText: getLastAssistantTextMock,
          getActiveToolNames: getActiveToolNamesMock,
          setActiveToolsByName: setActiveToolsByNameMock,
          messages: [],
        },
      });
    });
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'linear_main__get_issue', inputSchema: {type: 'object'}}],
      }),
      callTool: vi.fn().mockResolvedValue({content: [{type: 'text', text: 'issue'}]}),
    });
    promptMock.mockImplementationOnce(async () => {
      const directTool = customTools.find((tool) => tool.name === 'linear_main__get_issue');
      const outputTool = customTools.find((tool) => tool.name === 'set_output');
      if (directTool === undefined || outputTool === undefined) {
        throw new Error('Expected direct integration and output tools');
      }
      await directTool.execute(
        'call-1',
        {id: 'ENG-878'},
        new AbortController().signal,
        undefined,
        {} as never,
      );
      await outputTool.execute(
        'call-2',
        {key: 'summary', value: 'done'},
        new AbortController().signal,
        undefined,
        {} as never,
      );
    });
    getLastAssistantTextMock.mockReturnValue('done');

    await expect(
      piHarnessAdapter.run(
        invocation({mcpServers: [bridge], outputs: {summary: {type: 'string'}}}),
      ),
    ).resolves.toEqual({response: 'done', outputs: {summary: 'done'}});
    expect(bridge.callTool).toHaveBeenCalledWith('linear_main__get_issue', {id: 'ENG-878'});
  });

  it('fails closed when a direct integration tool collides with set_output', async () => {
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'set_output', inputSchema: {type: 'object'}}],
      }),
    });

    const error = await piHarnessAdapter
      .run(invocation({mcpServers: [bridge], outputs: {summary: {type: 'string'}}}))
      .catch((caught) => caught);

    expect(error).toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_catalog_unavailable',
      message:
        'Pi integration tool catalog unavailable for "shipfox_integration_tools": Integration tool name collides with SDK custom tool "set_output".',
    });
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('fails closed when a direct integration tool collides with a Pi built-in', async () => {
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'mcp', inputSchema: {type: 'object'}}],
      }),
    });

    const error = await piHarnessAdapter
      .run(invocation({mcpServers: [bridge]}))
      .catch((caught) => caught);

    expect(error).toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_catalog_unavailable',
      message:
        'Pi integration tool catalog unavailable for "shipfox_integration_tools": Integration tool name collides with Pi built-in tool "mcp".',
    });
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('reports direct tool registration failures as catalog failures', async () => {
    defineToolMock.mockImplementationOnce(() => {
      throw new Error('invalid direct tool definition');
    });
    const bridge = mcpBridge({
      listTools: vi.fn().mockResolvedValue({
        tools: [{name: 'linear_main__get_issue', inputSchema: {type: 'object'}}],
      }),
    });

    const error = await piHarnessAdapter
      .run(invocation({mcpServers: [bridge]}))
      .catch((caught) => caught);

    expect(error).toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_catalog_unavailable',
      message:
        'Pi integration tool catalog unavailable for "shipfox_integration_tools": invalid direct tool definition',
    });
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('keeps the MCP proxy available when discovery metadata is unavailable', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));
    const bridge = mcpBridge({
      listTools: vi.fn().mockRejectedValue(new Error('gateway unavailable')),
    });

    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        mcpServers: [bridge],
        tools: ['read'],
        toolSurface: 'discovery',
      }),
    );

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({tools: ['read', 'mcp']}),
    );
  });

  it('omits the Pi tools option when no tools are selected', async () => {
    await piHarnessAdapter.run(invocation());

    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty('tools');
    expect(options).not.toHaveProperty('noTools');
  });

  it('keeps default Pi tools for custom providers when tools are not selected', async () => {
    const model = {provider: 'local-ollama', id: 'llama'};
    findMock.mockReturnValue(model);

    await piHarnessAdapter.run(
      invocation({
        provider: 'local-ollama',
        model: 'llama',
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(expect.objectContaining({model}));
    expect(options).not.toHaveProperty('tools');
    expect(options).not.toHaveProperty('noTools');
  });

  it('keeps default Pi tools for custom providers when MCP is configured', async () => {
    const model = {provider: 'local-ollama', id: 'llama'};
    findMock.mockReturnValue(model);
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-mcp-'));

    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir: join(sessionDir, 'runner-agent'),
        provider: 'local-ollama',
        model: 'llama',
        mcpServers: [mcpBridge()],
        customProvider: customProvider({models: [{id: 'llama', label: 'Llama'}]}),
      }),
    );

    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(expect.objectContaining({model}));
    expect(options).not.toHaveProperty('tools');
    expect(options).not.toHaveProperty('noTools');
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
    const options = createAgentSessionMock.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        model,
        customTools: [expect.objectContaining({name: 'set_output'})],
      }),
    );
    expect(setActiveToolsByNameMock).toHaveBeenCalledWith([
      'set_output',
      'read',
      'bash',
      'edit',
      'write',
    ]);
    expect(options).not.toHaveProperty('noTools');
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
        bindExtensions: bindExtensionsMock,
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
      message: expect.stringContaining('Agent step finished without required outputs: summary'),
      response: 'final text without output',
    });
    expect(promptMock).toHaveBeenCalledTimes(3);
  });

  it('stops after one completed multi-output tool batch', async () => {
    let customTools: Array<{
      execute: (toolCallId: string, params: {key: string; value: string}) => Promise<unknown>;
    }> = [];
    let shouldStopAfterTurn: (() => boolean) | undefined;
    createAgentSessionMock.mockImplementation((options) => {
      customTools = options.customTools;
      return Promise.resolve({
        session: {
          agent: {
            set shouldStopAfterTurn(value: typeof shouldStopAfterTurn) {
              shouldStopAfterTurn = value;
            },
            get shouldStopAfterTurn() {
              return shouldStopAfterTurn;
            },
          },
          prompt: promptMock,
          abort: abortMock,
          bindExtensions: bindExtensionsMock,
          getLastAssistantText: getLastAssistantTextMock,
          messages: [],
        },
      });
    });
    promptMock.mockImplementation(async () => {
      await customTools[0]?.execute('tool-1', {key: 'summary', value: 'done'});
      expect(shouldStopAfterTurn?.()).toBe(false);
      await customTools[0]?.execute('tool-2', {key: 'count', value: '2'});
      expect(shouldStopAfterTurn?.()).toBe(true);
    });

    const result = await piHarnessAdapter.run(
      invocation({outputs: {summary: {type: 'string'}, count: {type: 'number'}}}),
    );

    expect(promptMock).toHaveBeenCalledOnce();
    expect(result).toEqual({response: '', outputs: {summary: 'done', count: '2'}});
  });

  it('gates completion on a successful prerequisite tool call', async () => {
    let customTools: Array<{
      execute: (toolCallId: string, params: {key: string; value: string}) => Promise<unknown>;
    }> = [];
    let afterToolCall:
      | ((context: {
          toolCall: {name: string};
          args: {method: string};
          context: object;
          result: {details: object; content: never[]};
          isError: boolean;
        }) => Promise<unknown>)
      | undefined;
    let shouldStopAfterTurn: (() => boolean) | undefined;
    createAgentSessionMock.mockImplementation((options) => {
      customTools = options.customTools;
      return Promise.resolve({
        session: {
          agent: {
            set afterToolCall(value: typeof afterToolCall) {
              afterToolCall = value;
            },
            get afterToolCall() {
              return afterToolCall;
            },
            set shouldStopAfterTurn(value: typeof shouldStopAfterTurn) {
              shouldStopAfterTurn = value;
            },
            get shouldStopAfterTurn() {
              return shouldStopAfterTurn;
            },
          },
          prompt: promptMock,
          abort: abortMock,
          bindExtensions: bindExtensionsMock,
          getLastAssistantText: getLastAssistantTextMock,
          messages: [],
        },
      });
    });
    promptMock
      .mockImplementationOnce(async () => {
        await customTools[0]?.execute('tool-1', {key: 'summary', value: 'done'});
        expect(shouldStopAfterTurn?.()).toBe(false);
      })
      .mockImplementationOnce(async () => {
        await afterToolCall?.({
          toolCall: {name: 'github__pull_request_read'},
          args: {method: 'get_diff'},
          context: {},
          result: {details: {}, content: []},
          isError: false,
        });
        expect(shouldStopAfterTurn?.()).toBe(true);
      });

    const result = piHarnessAdapter.run(
      invocation({
        outputs: {summary: {type: 'string'}},
        prerequisites: {required: ['pull_request_read.get_diff']},
      }),
    );

    await expect(result).resolves.toEqual({response: '', outputs: {summary: 'done'}});
    expect(promptMock).toHaveBeenCalledTimes(2);
  });

  it('returns the final assistant response and collected outputs after a correction turn', async () => {
    let customTools: Array<{
      execute: (toolCallId: string, params: {key: string; value: string}) => Promise<unknown>;
    }> = [];
    createAgentSessionMock.mockImplementation((options) => {
      customTools = options.customTools;
      return Promise.resolve({
        session: {
          agent: {},
          prompt: promptMock,
          abort: abortMock,
          bindExtensions: bindExtensionsMock,
          getLastAssistantText: getLastAssistantTextMock,
          getActiveToolNames: getActiveToolNamesMock,
          setActiveToolsByName: setActiveToolsByNameMock,
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
              thinking_level_map: {off: 'none', minimal: null, high: 'high'},
              compat: {
                supportsDeveloperRole: true,
                supportsStrictMode: true,
                supportsToolSearch: true,
              },
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
            thinkingLevelMap: {off: 'none', minimal: null, high: 'high'},
            compat: {
              supportsDeveloperRole: true,
              supportsStrictMode: true,
              supportsToolSearch: true,
            },
          },
        ],
      }),
    );
  });

  it.each([
    {
      name: 'Anthropic adaptive thinking',
      api: 'anthropic-messages',
      thinking_level_map: {off: null, xhigh: 'xhigh', max: 'max'},
      compat: {forceAdaptiveThinking: true, supportsStrictTools: true},
    },
    {
      name: 'OpenAI Responses effort mapping',
      api: 'openai-responses',
      thinking_level_map: {
        off: 'none',
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      compat: {
        supportsStrictMode: true,
        supportsOpenAIGrammarTools: true,
        supportsToolSearch: true,
        supportsExplicitPromptCacheMode: true,
      },
    },
    {
      name: 'DeepSeek reasoning format',
      api: 'openai-completions',
      thinking_level_map: {minimal: null, low: null, medium: null, high: 'high', max: 'max'},
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: 'deepseek',
      },
    },
    {
      name: 'Zai reasoning format',
      api: 'openai-completions',
      thinking_level_map: {minimal: null, low: 'high', medium: 'high', high: 'high', max: 'max'},
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        thinkingFormat: 'zai',
        zaiToolStream: true,
      },
    },
    {
      name: 'Moonshot Kimi reasoning format',
      api: 'openai-completions',
      thinking_level_map: {
        off: null,
        minimal: null,
        low: 'low',
        medium: null,
        high: 'high',
        xhigh: null,
        max: 'max',
      },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: true,
        maxTokensField: 'max_tokens',
        supportsStrictMode: false,
        thinkingFormat: 'openai',
        requiresReasoningContentOnAssistantMessages: true,
        deferredToolsMode: 'kimi',
      },
    },
  ] as const)('$name metadata remains attached to the gateway model', async (model) => {
    findMock.mockReturnValue({provider: 'managed', id: 'managed-model'});

    await piHarnessAdapter.run(
      invocation({
        provider: 'managed',
        model: 'managed-model',
        customProvider: customProvider({
          api: model.api,
          base_url: 'https://gateway.example.test/v1',
          models: [
            {
              id: 'managed-model',
              label: 'Managed model',
              reasoning: true,
              thinking_level_map: model.thinking_level_map,
              compat: model.compat,
            },
          ],
        }),
      }),
    );

    expect(registerProviderMock).toHaveBeenCalledWith(
      'managed',
      expect.objectContaining({
        baseUrl: 'https://gateway.example.test/v1',
        models: [
          expect.objectContaining({
            id: 'managed-model',
            api: model.api,
            reasoning: true,
            thinkingLevelMap: model.thinking_level_map,
            compat: model.compat,
          }),
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

  it('maps a non-loadable resumed session to AgentSessionUnavailableError', async () => {
    sessionManagerOpenMock.mockImplementation(() => {
      throw new Error('invalid session file');
    });

    await expect(
      piHarnessAdapter.run(
        invocation({session: {mode: 'resume', file: '/runner-agent/job-1/session.jsonl'}}),
      ),
    ).rejects.toEqual(
      new AgentSessionUnavailableError('Pi could not load the agent session: invalid session file'),
    );
    expect(sessionManagerOpenMock).toHaveBeenCalledWith(
      '/runner-agent/job-1/session.jsonl',
      join('/runner-agent/job-1', 'agent-sessions'),
      '/work',
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('attaches session metadata when a resumed run fails after creating the session', async () => {
    const sessionFile = join(tmpdir(), 'shipfox-resumed-session.jsonl');
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        getLastAssistantText: getLastAssistantTextMock,
        getActiveToolNames: getActiveToolNamesMock,
        setActiveToolsByName: setActiveToolsByNameMock,
        messages: [],
        sessionFile,
        sessionId: 'pi-session-1',
      },
    });
    promptMock.mockRejectedValue(new Error('prompt failed'));

    await expect(
      piHarnessAdapter.run(
        invocation({session: {mode: 'resume', file: '/runner-agent/job-1/session.jsonl'}}),
      ),
    ).rejects.toMatchObject({
      name: 'AgentInvocationError',
      message: 'prompt failed',
      sessionFile,
      sessionId: 'pi-session-1',
    });
  });

  it('does not attach or retain a forked session when the run fails', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-session-'));
    const agentStateDir = join(sessionDir, 'runner-agent');
    const sessionFile = join(agentStateDir, 'agent-sessions', 'fork.jsonl');
    mkdirSync(join(agentStateDir, 'agent-sessions'), {recursive: true});
    writeFileSync(sessionFile, '{"type":"session"}\n');
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
        sessionFile,
        sessionId: 'pi-session-1',
      },
    });
    promptMock.mockRejectedValue(new Error('prompt failed'));

    const error = await piHarnessAdapter
      .run(
        invocation({
          cwd: sessionDir,
          agentStateDir,
          session: {mode: 'fork', file: join(sessionDir, 'source.jsonl')},
        }),
      )
      .catch((caught) => caught);

    expect(error).toMatchObject({name: 'AgentInvocationError', message: 'prompt failed'});
    expect(error.sessionFile).toBeUndefined();
    expect(error.sessionId).toBeUndefined();
    expect(existsSync(sessionFile)).toBe(false);
  });

  it('maps a fork load failure to AgentSessionUnavailableError', async () => {
    const errorLog = vi.spyOn(logger(), 'error').mockImplementation(() => undefined);
    sessionManagerForkFromMock.mockImplementation(() => {
      throw new Error('invalid session file');
    });

    await expect(
      piHarnessAdapter.run(
        invocation({session: {mode: 'fork', file: '/runner-agent/job-1/session.jsonl'}}),
      ),
    ).rejects.toEqual(
      new AgentSessionUnavailableError('Pi could not load the agent session: invalid session file'),
    );
    expect(sessionManagerForkFromMock).toHaveBeenCalledWith(
      '/runner-agent/job-1/session.jsonl',
      '/work',
      join('/runner-agent/job-1', 'agent-sessions'),
    );
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_session_load_failed',
        sessionMode: 'fork',
        sessionFile: '/runner-agent/job-1/session.jsonl',
        err: expect.any(Error),
      }),
      'Agent session load failed',
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('rejects a resumed session with no transcript entries', async () => {
    sessionManagerOpenMock.mockReturnValue({
      getHeader: () => ({type: 'session'}),
      getEntries: () => [],
    });

    await expect(
      piHarnessAdapter.run(
        invocation({session: {mode: 'resume', file: '/runner-agent/job-1/session.jsonl'}}),
      ),
    ).rejects.toEqual(
      new AgentSessionUnavailableError(
        'Pi could not load the agent session: session has no transcript entries',
      ),
    );
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it('falls back to a fresh fork when the source has no transcript head', async () => {
    sessionManagerForkFromMock.mockImplementation(() => {
      throw new Error(
        'Cannot fork: source session file is empty or invalid: /runner-agent/job-1/session.jsonl',
      );
    });

    await piHarnessAdapter.run(
      invocation({session: {mode: 'fork', file: '/runner-agent/job-1/session.jsonl'}}),
    );

    expect(sessionManagerCreateMock).toHaveBeenCalledWith(
      '/work',
      join('/runner-agent/job-1', 'agent-sessions'),
    );
  });

  it('forks a loaded session into the local Pi session directory', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-session-'));
    const agentStateDir = join(sessionDir, 'runner-agent');
    const sourceFile = join(agentStateDir, 'sessions', 'source.jsonl');
    const forkedSessionFile = join(agentStateDir, 'agent-sessions', 'fork.jsonl');
    const forkedManager = {};
    sessionManagerForkFromMock.mockReturnValue(forkedManager);
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
        sessionFile: forkedSessionFile,
      },
    });

    const result = await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir,
        session: {mode: 'fork', file: sourceFile},
      }),
    );

    expect(sessionManagerForkFromMock).toHaveBeenCalledWith(
      sourceFile,
      sessionDir,
      join(agentStateDir, 'agent-sessions'),
    );
    expect(sessionManagerOpenMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({sessionManager: forkedManager}),
    );
    expect(result).toEqual({response: ''});
  });

  it('creates a fresh local session when a fork has no transcript head', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-session-'));
    const agentStateDir = join(sessionDir, 'runner-agent');
    const sessionFile = join(sessionDir, 'fresh.jsonl');
    writeFileSync(sessionFile, '{"type":"session"}\n');
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
        sessionFile,
      },
    });
    promptMock.mockImplementation(() => {
      appendFileSync(sessionFile, '{"type":"message","id":"fresh"}\n');
      return Promise.resolve();
    });
    const entries: string[] = [];

    await piHarnessAdapter.run(
      invocation({
        cwd: sessionDir,
        agentStateDir,
        onSessionEntry: (line) => entries.push(line),
        session: {mode: 'fork'},
      }),
    );

    expect(sessionManagerCreateMock).toHaveBeenCalledWith(
      sessionDir,
      join(agentStateDir, 'agent-sessions'),
    );
    expect(sessionManagerForkFromMock).not.toHaveBeenCalled();
    expect(entries).toEqual(['{"type":"session"}', '{"type":"message","id":"fresh"}']);
  });

  it('returns the synchronously appended resumed session file for committing', async () => {
    sessionDir = mkdtempSync(join(tmpdir(), 'shipfox-pi-session-'));
    const sourceFile = join(sessionDir, 'source.jsonl');
    const committedFile = join(sessionDir, 'committed.jsonl');
    appendFileSync(sourceFile, '{"type":"session"}\n');
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: promptMock,
        abort: abortMock,
        bindExtensions: bindExtensionsMock,
        getLastAssistantText: getLastAssistantTextMock,
        messages: [],
        sessionFile: committedFile,
        sessionId: 'pi-session-1',
      },
    });
    promptMock.mockImplementation(() => {
      appendFileSync(committedFile, '{"type":"message","id":"a"}\n');
      return Promise.resolve();
    });

    const result = await piHarnessAdapter.run(
      invocation({session: {mode: 'resume', file: sourceFile}}),
    );

    expect(result).toEqual({
      response: '',
      sessionFile: committedFile,
      sessionId: 'pi-session-1',
    });
    expect(readFileSync(committedFile, 'utf8')).toBe('{"type":"message","id":"a"}\n');
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
        bindExtensions: bindExtensionsMock,
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
        bindExtensions: bindExtensionsMock,
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
