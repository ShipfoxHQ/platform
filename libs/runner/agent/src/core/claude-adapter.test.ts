const {createSdkMcpServerMock, queryMock, toolMock} = vi.hoisted(() => ({
  createSdkMcpServerMock: vi.fn((options) => options),
  queryMock: vi.fn(),
  toolMock: vi.fn((name, description, inputSchema, handler, extras) => ({
    name,
    description,
    inputSchema,
    handler,
    extras,
  })),
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
const {configMock} = vi.hoisted(() => ({
  configMock: {
    AGENT_CLAUDE_ANTHROPIC_BASE_URL: undefined as string | undefined,
    AGENT_CLAUDE_ANTHROPIC_MODEL: undefined as string | undefined,
    AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL: undefined as string | undefined,
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: createSdkMcpServerMock,
  query: queryMock,
  tool: toolMock,
}));
vi.mock('#config.js', () => ({
  config: configMock,
  runnerEgressPolicy: () => ({allowPrivateNetworks: true, hostDenylist: []}),
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

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claudeHarnessAdapter} from '#core/claude-adapter.js';
import {AgentConfigError} from '#core/errors.js';
import type {HarnessInvocation} from '#core/harness.js';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';

function invocation(overrides: Partial<HarnessInvocation> = {}): HarnessInvocation {
  return {
    cwd: testCwd,
    model: 'claude-opus-4-8',
    provider: 'anthropic',
    thinking: 'xhigh',
    prompt: 'Fix it.',
    credentials: {api_key: 'sk-runtime-secret'},
    signal: new AbortController().signal,
    ...overrides,
  };
}

function makeQuery(messages: unknown[]) {
  const close = vi.fn();
  return {
    close,
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const message of messages) yield message;
    },
  };
}

function makeBlockingQuery(messages: unknown[]) {
  let release: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const close = vi.fn(() => release());
  return {
    close,
    async *[Symbol.asyncIterator]() {
      for (const message of messages) yield message;
      await closed;
    },
  };
}

function makeThrowingQuery(error: Error) {
  const close = vi.fn();
  return {
    close,
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(error),
    }),
  };
}

function mcpBridge(): IntegrationToolsBridge {
  return {
    name: 'shipfox_integration_tools',
    server: {} as IntegrationToolsBridge['server'],
    listTools: vi.fn(),
    callTool: vi.fn(),
    activateHttp: vi.fn(),
    close: vi.fn(),
  };
}

function lastQueryOptions(): {
  env: NodeJS.ProcessEnv;
  abortController: AbortController;
  mcpServers?: unknown;
  model?: string;
  tools?: string[];
} {
  const call = queryMock.mock.calls[0] as
    | [
        {
          options: {
            env: NodeJS.ProcessEnv;
            abortController: AbortController;
            mcpServers?: unknown;
            model?: string;
            tools?: string[];
          };
        },
      ]
    | undefined;
  if (call === undefined) throw new Error('Expected Claude SDK query to be called.');
  return call[0].options;
}

const initMessage = {type: 'system', subtype: 'init', session_id: 'session-1'};
const assistantMessage = {type: 'assistant', message: {content: [{type: 'text', text: 'Working'}]}};
const successMessage = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
};

let testCwd = '';
let previousAnthropicApiKey: string | undefined;

describe('claudeHarnessAdapter', () => {
  beforeEach(() => {
    testCwd = mkdtempSync(join(tmpdir(), 'shipfox-claude-adapter-'));
    previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    queryMock.mockReset();
    toolMock.mockClear();
    createSdkMcpServerMock.mockClear();
    assertEgressAllowedMock.mockReset();
    assertEgressAllowedMock.mockResolvedValue(undefined);
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = undefined;
    configMock.AGENT_CLAUDE_ANTHROPIC_MODEL = undefined;
    configMock.AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL = undefined;
  });

  afterEach(() => {
    if (previousAnthropicApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey;
    rmSync(testCwd, {recursive: true, force: true});
  });

  it('forwards each SDK message as JSON and returns the result text as response', async () => {
    const entries: string[] = [];
    queryMock.mockReturnValue(makeQuery([initMessage, assistantMessage, successMessage]));

    const result = await claudeHarnessAdapter.run(
      invocation({onSessionEntry: (entry) => entries.push(entry)}),
    );

    expect(result).toEqual({response: 'done'});
    expect(entries.map((entry) => JSON.parse(entry) as unknown)).toEqual([
      initMessage,
      assistantMessage,
      successMessage,
    ]);
  });

  it('keeps session forwarding best-effort when onSessionEntry throws', async () => {
    queryMock.mockReturnValue(makeQuery([assistantMessage, successMessage]));

    const result = await claudeHarnessAdapter.run(
      invocation({
        onSessionEntry: () => {
          throw new Error('log sink closed');
        },
      }),
    );

    expect(result).toEqual({response: 'done'});
  });

  it.each([
    [{type: 'result', subtype: 'success', is_error: true, result: 'out of credits'}],
    [{type: 'result', subtype: 'error_max_turns', is_error: true, errors: ['turn limit']}],
    [
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['billing error'],
      },
    ],
  ])('treats Claude error result %# as step failure', async (resultMessage) => {
    queryMock.mockReturnValue(makeQuery([resultMessage]));

    const result = claudeHarnessAdapter.run(invocation());

    await expect(result).rejects.toThrow(
      'result' in resultMessage ? resultMessage.result : resultMessage.errors[0],
    );
  });

  it('throws an AgentConfigError when the Anthropic API key is missing', async () => {
    const result = claudeHarnessAdapter.run(invocation({credentials: {}}));

    await expect(result).rejects.toThrow(
      new AgentConfigError(
        'No credentials configured for provider "anthropic". ' +
          'Verify the provider is configured for this workspace.',
        'provider_not_configured',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([
    [invocation({provider: 'openai'}), 'Harness "claude" only supports provider "anthropic"'],
    [
      invocation({
        customProvider: {
          api: 'openai-responses',
          base_url: 'https://models.example.test/v1',
          headers: [],
          secret_header_names: [],
          models: [{id: 'custom', label: 'Custom'}],
          requires_api_key: true,
        },
      }),
      'Harness "claude" does not support custom model providers.',
    ],
  ])('rejects unsupported provider configuration %#', async (badInvocation, message) => {
    const result = claudeHarnessAdapter.run(badInvocation);

    await expect(result).rejects.toThrow(message);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps Anthropic egress denial to AgentConfigError', async () => {
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('host-denied', 'api.anthropic.com'),
    );

    const result = claudeHarnessAdapter.run(invocation());

    await expect(result).rejects.toThrow(
      new AgentConfigError(
        'Claude Anthropic API endpoint blocked by egress policy: host-denied (api.anthropic.com).',
        'step_config_invalid',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('uses the Anthropic base URL override without requiring an API key', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    configMock.AGENT_CLAUDE_ANTHROPIC_MODEL = 'smollm2:135m-instruct-q2_K';
    configMock.AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL = 'smollm2:135m-instruct-q2_K';
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({credentials: {}}));

    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(createSdkMcpServerMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        model: 'smollm2:135m-instruct-q2_K',
        tools: [],
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: 'ollama',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434',
          ANTHROPIC_MODEL: 'smollm2:135m-instruct-q2_K',
          ANTHROPIC_SMALL_FAST_MODEL: 'smollm2:135m-instruct-q2_K',
        }),
      }),
    });
    expect(lastQueryOptions().mcpServers).toBeUndefined();
  });

  it('keeps integration bridges available with the Anthropic base URL override', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    const bridge = mcpBridge();
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({credentials: {}, mcpServers: [bridge]}));

    expect(lastQueryOptions()).toMatchObject({
      tools: [],
      mcpServers: {
        shipfox_integration_tools: {
          type: 'sdk',
          name: 'shipfox_integration_tools',
          instance: bridge.server,
        },
      },
    });
  });

  it('registers declared output tools when the Anthropic base URL override is active', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));

    const result = claudeHarnessAdapter.run(
      invocation({credentials: {}, outputs: {summary: {type: 'string'}}}),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');
    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(createSdkMcpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'shipfox_outputs',
        tools: [expect.objectContaining({name: 'set_output'})],
      }),
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        tools: [],
        mcpServers: expect.objectContaining({
          shipfox_outputs: expect.objectContaining({name: 'shipfox_outputs'}),
        }),
      }),
    });
  });

  it('maps Anthropic override egress denial to AgentConfigError', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://blocked.example.test';
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('host-denied', 'blocked.example.test'),
    );

    const result = claudeHarnessAdapter.run(invocation({credentials: {}}));

    await expect(result).rejects.toThrow(
      new AgentConfigError(
        'Claude Anthropic base URL override blocked by egress policy: host-denied (blocked.example.test).',
        'step_config_invalid',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('passes Claude options, thinking effort, and child-process environment to query', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-parent';
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(
      invocation({thinking: 'max', gitConfigGlobal: '/runner/job/git-cred.config'}),
    );

    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-parent');
    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'https://api.anthropic.com',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        model: 'claude-opus-4-8',
        cwd: testCwd,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        thinking: {type: 'adaptive'},
        effort: 'max',
        persistSession: false,
        includePartialMessages: false,
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'sk-runtime-secret',
          GIT_CONFIG_GLOBAL: '/runner/job/git-cred.config',
          CLAUDE_AGENT_SDK_CLIENT_APP: '@shipfox/runner-agent',
        }),
      }),
    });
    const env = lastQueryOptions().env;
    expect(env.CLAUDE_CONFIG_DIR).toMatch(`${testCwd}/logs/claude-config-`);
    expect(lastQueryOptions()).not.toHaveProperty('tools');
    expect(lastQueryOptions().mcpServers).toBeUndefined();
  });

  it('passes selected Claude tool names through unchanged', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({tools: ['Read', 'Grep', 'WebSearch']}));

    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        tools: ['Read', 'Grep', 'WebSearch'],
      }),
    });
  });

  it('registers integration bridges with the Claude SDK transport', async () => {
    const bridge = mcpBridge();
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({mcpServers: [bridge]}));

    expect(lastQueryOptions().mcpServers).toEqual({
      shipfox_integration_tools: {
        type: 'sdk',
        name: 'shipfox_integration_tools',
        instance: bridge.server,
      },
    });
  });

  it('merges integration bridges with output tools', async () => {
    const bridge = mcpBridge();
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));

    const result = claudeHarnessAdapter.run(
      invocation({mcpServers: [bridge], outputs: {summary: {type: 'string'}}}),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');
    expect(lastQueryOptions().mcpServers).toEqual(
      expect.objectContaining({
        shipfox_integration_tools: {
          type: 'sdk',
          name: 'shipfox_integration_tools',
          instance: bridge.server,
        },
        shipfox_outputs: expect.objectContaining({name: 'shipfox_outputs'}),
      }),
    );
  });

  it('does not spawn Claude when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    const result = claudeHarnessAdapter.run(invocation({signal: ac.signal}));

    await expect(result).rejects.toThrow('aborted');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('aborts the SDK controller and closes the query when the signal fires', async () => {
    const ac = new AbortController();
    const blockingQuery = makeBlockingQuery([initMessage]);
    queryMock.mockReturnValue(blockingQuery);

    const result = claudeHarnessAdapter.run(invocation({signal: ac.signal}));
    await vi.waitFor(() => expect(queryMock).toHaveBeenCalled());
    ac.abort();

    await expect(result).rejects.toThrow('did not emit a result');
    expect(lastQueryOptions().abortController.signal.aborted).toBe(true);
    expect(blockingQuery.close).toHaveBeenCalled();
  });

  it('propagates SDK generator failures', async () => {
    queryMock.mockReturnValue(makeThrowingQuery(new Error('sdk auth failed')));

    const result = claudeHarnessAdapter.run(invocation());

    await expect(result).rejects.toThrow('sdk auth failed');
  });
});
