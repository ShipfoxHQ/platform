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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  CLAUDE_MANAGED_MODEL_FAMILY_IDS,
  CLAUDE_MODEL_FAMILY_IDS,
  CLAUDE_MODEL_LINE,
} from '@shipfox/api-agent-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {claudeHarnessAdapter} from '#core/claude-adapter.js';
import {AgentConfigError, AgentPermissionModeError} from '#core/errors.js';
import type {HarnessInvocation} from '#core/harness.js';
import type {IntegrationToolsBridge} from '#core/integration-tools-bridge.js';

// Mirrors claudeModelCapabilities() family normalization in the adapter.
const CLAUDE_SNAPSHOT_DATE_SUFFIX = /-\d{8}$/;
const ABORT_ERROR_PATTERN = /abort/i;

function invocation(overrides: Partial<HarnessInvocation> = {}): HarnessInvocation {
  return {
    cwd: testCwd,
    agentStateDir: join(testCwd, 'runner-agent'),
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

function makeQueryAfter(ready: Promise<unknown>, messages: unknown[]) {
  const close = vi.fn();
  return {
    close,
    async *[Symbol.asyncIterator]() {
      await ready;
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

function mcpBridge(
  toolNames: readonly string[] = [],
  overrides: Partial<
    Pick<IntegrationToolsBridge, 'listTools' | 'callTool' | 'activateHttp' | 'close'>
  > = {},
): IntegrationToolsBridge {
  return {
    name: 'shipfox_integration_tools',
    server: {} as IntegrationToolsBridge['server'],
    listTools: vi.fn().mockResolvedValue({
      tools: toolNames.map((name) => ({
        name,
        description: `Description for ${name}`,
        inputSchema: {type: 'object'},
      })),
    }),
    callTool: vi.fn(),
    activateHttp: vi.fn().mockResolvedValue(new URL('http://127.0.0.1:43123/mcp')),
    close: vi.fn(),
    ...overrides,
  };
}

type TestSessionStore = {
  append: (
    key: {projectKey: string; sessionId: string},
    entries: Array<{type: string; [key: string]: unknown}>,
  ) => Promise<void>;
};

function lastQueryOptions(): {
  env: NodeJS.ProcessEnv;
  abortController: AbortController;
  mcpServers?: unknown;
  model?: string;
  tools?: string[];
  settingSources?: string[];
  strictMcpConfig?: boolean;
  thinking?: unknown;
  effort?: unknown;
  persistSession?: boolean;
  sessionStore?: TestSessionStore;
  sessionStoreFlush?: string;
  resume?: string;
  forkSession?: boolean;
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
            settingSources?: string[];
            strictMcpConfig?: boolean;
            thinking?: unknown;
            effort?: unknown;
          };
        },
      ]
    | undefined;
  if (call === undefined) throw new Error('Expected Claude SDK query to be called.');
  return call[0].options;
}

const initMessage = {
  type: 'system',
  subtype: 'init',
  session_id: 'session-1',
  permissionMode: 'bypassPermissions',
};
const assistantMessage = {type: 'assistant', message: {content: [{type: 'text', text: 'Working'}]}};
const successMessage = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
};

function initWithTools(tools: readonly string[]) {
  return {
    ...initMessage,
    tools,
    mcp_servers: [{name: 'shipfox_integration_tools', status: 'connected'}],
  };
}

function assistantToolUse(name: string, id: string) {
  return {
    type: 'assistant',
    message: {
      content: [{type: 'tool_use', id, name, input: {secret: 'not logged'}}],
    },
  };
}

function toolProgress(name: string, id: string) {
  return {
    type: 'tool_progress',
    tool_name: name,
    tool_use_id: id,
  };
}

function userToolResult(id: string, isError = false) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          is_error: isError,
          content: [{type: 'text', text: 'tool response is not logged'}],
        },
      ],
    },
  };
}

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
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: 'ollama',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434',
          ANTHROPIC_MODEL: 'smollm2:135m-instruct-q2_K',
          ANTHROPIC_SMALL_FAST_MODEL: 'smollm2:135m-instruct-q2_K',
        }),
      }),
    });
    expect(lastQueryOptions()).not.toHaveProperty('tools');
    expect(lastQueryOptions().mcpServers).toBeUndefined();
  });

  it('uses per-step Claude runtime credentials before the instance-wide override', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    configMock.AGENT_CLAUDE_ANTHROPIC_MODEL = 'instance-model';
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(
      invocation({
        credentials: {api_key: 'workspace-token'},
        claude: {
          base_url: 'https://gateway.example.test/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'https://gateway.example.test/v1',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        model: 'claude-opus-4-8',
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: 'managed-token',
          ANTHROPIC_BASE_URL: 'https://gateway.example.test/v1',
        }),
      }),
    });
    expect(lastQueryOptions()).not.toHaveProperty('tools');
    expect(lastQueryOptions().env).not.toHaveProperty('ANTHROPIC_MODEL');
  });

  it('accepts a managed provider with the per-step claude runtime block', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    const result = await claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        credentials: {api_key: 'managed-token'},
        claude: {
          base_url: 'https://inference.shipfox.dev/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    expect(result).toEqual({response: 'done'});
    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'https://inference.shipfox.dev/v1',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        model: 'claude-opus-4-8',
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: '',
          ANTHROPIC_AUTH_TOKEN: 'managed-token',
          ANTHROPIC_BASE_URL: 'https://inference.shipfox.dev/v1',
        }),
      }),
    });
    expect(lastQueryOptions().env).not.toHaveProperty('ANTHROPIC_MODEL');
  });

  it('rejects a managed provider without the per-step claude runtime block', async () => {
    const result = claudeHarnessAdapter.run(invocation({provider: 'shipfox'}));

    await expect(result).rejects.toEqual(
      new AgentConfigError(
        'Harness "claude" requires the server-issued per-step claude runtime block for provider "shipfox"; the block was not present in this invocation.',
        'provider_unsupported',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed per-step claude runtime block', async () => {
    const result = claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        credentials: {api_key: 'managed-token'},
        claude: {base_url: '', auth_token: ''},
      }),
    );

    await expect(result).rejects.toEqual(
      new AgentConfigError(
        'Harness "claude" received a malformed per-step claude runtime block.',
        'step_config_invalid',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('maps a managed provider egress denial to AgentConfigError', async () => {
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('host-denied', 'inference.shipfox.dev'),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        credentials: {api_key: 'managed-token'},
        claude: {
          base_url: 'https://inference.shipfox.dev/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    await expect(result).rejects.toEqual(
      new AgentConfigError(
        'Claude Anthropic per-step endpoint blocked by egress policy: host-denied (inference.shipfox.dev).',
        'step_config_invalid',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('surfaces a managed provider error result instead of swallowing it', async () => {
    queryMock.mockReturnValue(
      makeQuery([
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['managed provider rejected the request'],
        },
      ]),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        credentials: {api_key: 'managed-token'},
        claude: {
          base_url: 'https://inference.shipfox.dev/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    await expect(result).rejects.toThrow('managed provider rejected the request');
  });

  it('keeps integration bridges available with the Anthropic base URL override', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    const bridge = mcpBridge();
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({credentials: {}, mcpServers: [bridge]}));

    expect(lastQueryOptions()).toMatchObject({
      mcpServers: {
        shipfox_integration_tools: {
          type: 'http',
          url: 'http://127.0.0.1:43123/mcp',
          alwaysLoad: true,
        },
      },
    });
    expect(lastQueryOptions()).not.toHaveProperty('tools');
  });

  it('registers declared output tools when the Anthropic base URL override is active', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));
    const schema = {type: 'array', items: {type: 'string'}};

    const result = claudeHarnessAdapter.run(
      invocation({credentials: {}, outputs: {findings: {type: 'json', schema}}}),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: findings');
    expect(assertEgressAllowedMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434',
      expect.objectContaining({allowPrivateNetworks: true}),
    );
    expect(createSdkMcpServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'shipfox_outputs',
        instructions: expect.stringContaining(JSON.stringify(schema, null, 2)),
        tools: [expect.objectContaining({name: 'set_output'})],
      }),
    );
    expect(queryMock).toHaveBeenCalledWith({
      prompt: expect.any(Object),
      options: expect.objectContaining({
        mcpServers: expect.objectContaining({
          shipfox_outputs: expect.objectContaining({name: 'shipfox_outputs'}),
        }),
      }),
    });
    expect(lastQueryOptions()).not.toHaveProperty('tools');
  });

  it('keeps the output tool enabled when Claude tools are explicitly selected', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));

    const result = claudeHarnessAdapter.run(
      invocation({tools: ['Read'], outputs: {summary: {type: 'string'}}}),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');
    expect(lastQueryOptions()).toEqual(
      expect.objectContaining({
        tools: ['Read', 'mcp__shipfox_outputs__set_output'],
        mcpServers: expect.objectContaining({
          shipfox_outputs: expect.objectContaining({name: 'shipfox_outputs'}),
        }),
      }),
    );
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

  it('maps per-step endpoint egress denial to AgentConfigError', async () => {
    assertEgressAllowedMock.mockRejectedValue(
      new EgressDeniedErrorMock('host-denied', 'gateway.example.test'),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        credentials: {},
        claude: {
          base_url: 'https://gateway.example.test/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    await expect(result).rejects.toThrow(
      new AgentConfigError(
        'Claude Anthropic per-step endpoint blocked by egress policy: host-denied (gateway.example.test).',
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
        settingSources: [],
        strictMcpConfig: true,
        thinking: {type: 'adaptive'},
        effort: 'max',
        persistSession: false,
        includePartialMessages: false,
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: 'sk-runtime-secret',
          GIT_CONFIG_GLOBAL: '/runner/job/git-cred.config',
          CLAUDE_AGENT_SDK_CLIENT_APP: '@shipfox/runner-agent',
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        }),
      }),
    });
    const env = lastQueryOptions().env;
    expect(env.CLAUDE_CONFIG_DIR).toMatch(`${testCwd}/runner-agent/claude-config-`);
    expect(lastQueryOptions()).not.toHaveProperty('tools');
    expect(lastQueryOptions().mcpServers).toBeUndefined();
  });

  it('sends budget-based extended thinking without effort for Claude Haiku 4.5', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-haiku-4-5', thinking: 'medium'}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-haiku-4-5',
      thinking: {type: 'enabled', budgetTokens: 8_192},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('resolves dated Claude snapshot IDs to their family capabilities', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(
      invocation({model: 'claude-haiku-4-5-20251001', thinking: 'low'}),
    );

    expect(lastQueryOptions()).toMatchObject({
      thinking: {type: 'enabled', budgetTokens: 4_096},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('passes managed model IDs through without punctuation-based rewriting', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        model: 'catalog.model-id',
        claude: {
          base_url: 'https://inference.shipfox.dev/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    expect(lastQueryOptions().model).toBe('catalog.model-id');
    expect(lastQueryOptions()).not.toHaveProperty('thinking');
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('sends budget-based extended thinking without effort for Claude Sonnet 4.5', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-sonnet-4-5', thinking: 'high'}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-sonnet-4-5',
      thinking: {type: 'enabled', budgetTokens: 16_384},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('sends budget-based thinking with a supported effort level for Claude Opus 4.5', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-5', thinking: 'medium'}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-opus-4-5',
      thinking: {type: 'enabled', budgetTokens: 8_192},
      effort: 'medium',
    });
  });

  it.each([
    'xhigh',
    'max',
  ] as const)('caps Claude Opus 4.5 thinking level %s to the 31,999-token budget ceiling and falls back to the nearest supported effort level', async (thinking) => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-5', thinking}));

    expect(lastQueryOptions()).toMatchObject({
      thinking: {type: 'enabled', budgetTokens: 31_999},
      effort: 'high',
    });
  });

  it.each([
    'xhigh',
    'max',
  ] as const)('caps Claude Opus 4.1 thinking level %s to the 32,000-token output ceiling', async (thinking) => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-1', thinking}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-opus-4-1',
      thinking: {type: 'enabled', budgetTokens: 31_999},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('keeps Claude Opus 4.1 thinking budgets below the output ceiling unchanged', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-1', thinking: 'medium'}));

    expect(lastQueryOptions()).toMatchObject({
      thinking: {type: 'enabled', budgetTokens: 8_192},
    });
  });

  it('resolves every catalog Claude model to capability metadata', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    for (const model of CLAUDE_MODEL_LINE) {
      await claudeHarnessAdapter.run(invocation({model: model.id, thinking: 'low'}));

      expect(lastQueryOptions().thinking).toBeDefined();
      queryMock.mockClear();
    }
  });

  it('keys Claude capability metadata only to known Claude model families', () => {
    // Reverse direction of the catalog→capability test above: every capability
    // family must be reachable from the built-in catalog (CLAUDE_MODEL_LINE) or
    // be a managed shipfox-provider family, and every catalog family must have
    // a capability row. The adapter's CLAUDE_MODEL_CAPABILITIES keys are also
    // type-checked against CLAUDE_MODEL_FAMILY_IDS, so a mismatch between the
    // two lists fails here or at compile time instead of reaching production.
    const catalogFamilies = new Set(
      CLAUDE_MODEL_LINE.map(({id}) => id.replace(CLAUDE_SNAPSHOT_DATE_SUFFIX, '')),
    );
    const managedFamilies = new Set<string>(CLAUDE_MANAGED_MODEL_FAMILY_IDS);
    const capabilityFamilies = new Set<string>(CLAUDE_MODEL_FAMILY_IDS);

    for (const familyId of capabilityFamilies) {
      expect(catalogFamilies.has(familyId) || managedFamilies.has(familyId)).toBe(true);
    }
    for (const familyId of catalogFamilies) {
      expect(capabilityFamilies.has(familyId)).toBe(true);
    }
  });

  it('falls back to the nearest supported effort level on an adaptive model', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-6', thinking: 'xhigh'}));

    expect(lastQueryOptions()).toMatchObject({
      thinking: {type: 'adaptive'},
      effort: 'high',
    });
  });

  it('keeps adaptive thinking and a supported effort level for an adaptive model', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-8', thinking: 'xhigh'}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-opus-4-8',
      thinking: {type: 'adaptive'},
      effort: 'xhigh',
    });
  });

  it('uses the override model for the thinking capability lookup when it differs from the invocation model', async () => {
    configMock.AGENT_CLAUDE_ANTHROPIC_BASE_URL = 'http://127.0.0.1:11434';
    configMock.AGENT_CLAUDE_ANTHROPIC_MODEL = 'claude-haiku-4-5';
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-opus-4-8', thinking: 'medium'}));

    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-haiku-4-5',
      thinking: {type: 'enabled', budgetTokens: 8_192},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('sends no effort for a managed Haiku 4.5 step with medium thinking', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    const result = await claudeHarnessAdapter.run(
      invocation({
        provider: 'shipfox',
        model: 'claude-haiku-4-5',
        thinking: 'medium',
        credentials: {api_key: 'managed-token'},
        claude: {
          base_url: 'https://inference.shipfox.dev/v1',
          auth_token: 'managed-token',
        },
      }),
    );

    expect(result).toEqual({response: 'done'});
    expect(lastQueryOptions()).toMatchObject({
      model: 'claude-haiku-4-5',
      thinking: {type: 'enabled', budgetTokens: 8_192},
    });
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('rejects a thinking level the Claude harness does not support', async () => {
    const result = claudeHarnessAdapter.run(invocation({thinking: 'off'}));

    await expect(result).rejects.toEqual(
      new AgentConfigError(
        'Harness "claude" does not support thinking level "off". ' +
          'Supported levels: low, medium, high, xhigh, max.',
        'step_config_invalid',
      ),
    );
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('omits thinking and effort options for a model without capability metadata', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation({model: 'claude-sonnet-4', thinking: 'high'}));

    expect(lastQueryOptions()).not.toHaveProperty('thinking');
    expect(lastQueryOptions()).not.toHaveProperty('effort');
  });

  it('injects CLAUDE.md into the user prompt without promoting it to the system prompt', async () => {
    writeFileSync(join(testCwd, 'CLAUDE.md'), 'repository-instruction-marker');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({
      message: {
        content:
          'Fix it.\n\nRepository instructions; they do not override the task above:\n\n' +
          'repository-instruction-marker',
      },
    });
    expect(lastQueryOptions()).not.toHaveProperty('systemPrompt');
  });

  it('uses AGENTS.md when CLAUDE.md is absent', async () => {
    writeFileSync(join(testCwd, 'AGENTS.md'), 'agents-instruction-marker');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({
      message: {content: expect.stringContaining('agents-instruction-marker')},
    });
  });

  it('prefers CLAUDE.md when both repository instruction files exist', async () => {
    writeFileSync(join(testCwd, 'CLAUDE.md'), 'claude-instruction-marker');
    writeFileSync(join(testCwd, 'AGENTS.md'), 'agents-instruction-marker');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({
      message: {content: expect.stringContaining('claude-instruction-marker')},
    });
    expect((message.value as {message: {content: string}}).message.content).not.toContain(
      'agents-instruction-marker',
    );
  });

  it('treats an empty repository instruction file as absent', async () => {
    writeFileSync(join(testCwd, 'CLAUDE.md'), '');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({message: {content: 'Fix it.'}});
  });

  it('does not append repository instructions when neither file exists', async () => {
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({message: {content: 'Fix it.'}});
  });

  it('falls through to AGENTS.md when CLAUDE.md cannot be read', async () => {
    symlinkSync(join(testCwd, 'missing-CLAUDE.md'), join(testCwd, 'CLAUDE.md'));
    writeFileSync(join(testCwd, 'AGENTS.md'), 'agents-fallback-marker');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({
      message: {content: expect.stringContaining('agents-fallback-marker')},
    });
  });

  it('truncates repository instructions at 64 KiB', async () => {
    const content = `${'x'.repeat(64 * 1024)}repository-instruction-tail-marker`;
    writeFileSync(join(testCwd, 'CLAUDE.md'), content);
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    const pushedContent = (message.value as {message: {content: string}}).message.content;
    expect(pushedContent).toContain('x'.repeat(64 * 1024));
    expect(pushedContent).not.toContain('repository-instruction-tail-marker');
  });

  it('truncates repository instructions at a UTF-8 codepoint boundary', async () => {
    writeFileSync(join(testCwd, 'CLAUDE.md'), `${'x'.repeat(64 * 1024 - 1)}éé`);
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    const pushedContent = (message.value as {message: {content: string}}).message.content;
    expect(pushedContent).not.toContain('é');
    expect(pushedContent).not.toContain('\uFFFD');
  });

  it('treats whitespace-only repository instructions as absent', async () => {
    writeFileSync(join(testCwd, 'CLAUDE.md'), ' \n\t');
    queryMock.mockReturnValue(makeQuery([successMessage]));

    await claudeHarnessAdapter.run(invocation());

    const prompt = (queryMock.mock.calls[0] as [{prompt: AsyncIterable<unknown>}])[0].prompt;
    const message = await prompt[Symbol.asyncIterator]().next();
    expect(message.value).toMatchObject({message: {content: 'Fix it.'}});
  });

  it('fails when Claude downgrades the requested permission mode', async () => {
    queryMock.mockReturnValue(
      makeQuery([{...initMessage, permissionMode: 'default'}, successMessage]),
    );

    const result = claudeHarnessAdapter.run(invocation());

    await expect(result).rejects.toEqual(
      new AgentPermissionModeError('bypassPermissions', 'default'),
    );
  });

  it('allows an init message without permission mode for SDK-drift compatibility', async () => {
    queryMock.mockReturnValue(
      makeQuery([{type: 'system', subtype: 'init', session_id: 'session-1'}, successMessage]),
    );

    await expect(claudeHarnessAdapter.run(invocation())).resolves.toEqual({response: 'done'});
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
        type: 'http',
        url: 'http://127.0.0.1:43123/mcp',
        alwaysLoad: true,
        headers: {Authorization: expect.any(String)},
      },
    });
  });

  it('merges configured, integration, and managed tools', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const bridge = mcpBridge([integrationTool]);
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));

    const result = claudeHarnessAdapter.run(
      invocation({
        tools: ['Read'],
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        outputs: {summary: {type: 'string'}},
      }),
    );

    await expect(result).rejects.toThrow('Agent step finished without required outputs: summary');
    expect(lastQueryOptions().tools).toEqual(['Read', sdkTool, 'mcp__shipfox_outputs__set_output']);
    expect(lastQueryOptions().mcpServers).toEqual(
      expect.objectContaining({
        shipfox_integration_tools: {
          type: 'http',
          url: 'http://127.0.0.1:43123/mcp',
          alwaysLoad: true,
          headers: {Authorization: expect.any(String)},
        },
        shipfox_outputs: expect.objectContaining({name: 'shipfox_outputs'}),
      }),
    );
  });

  it('emits diagnostics when bridge activation fails before Claude starts', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    const bridge = mcpBridge([], {
      activateHttp: vi.fn().mockRejectedValue(new Error('bridge bind failed')),
    });

    const result = claudeHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'requested_tool_omitted',
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_manifest',
        omissions: [{toolName: integrationTool, reason: 'runner_capability'}],
      }),
      'Claude integration tool manifest',
    );
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'requested_tool_omitted',
        omissions: [{toolName: integrationTool, reason: 'runner_capability'}],
      }),
      'Claude integration tool outcome',
    );
  });

  it('continues after a catalog failure and records its taxonomy', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    const warnLog = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const bridge = mcpBridge([], {
      listTools: vi.fn().mockRejectedValue(new Error('gateway unavailable secret=do-not-log')),
    });
    queryMock.mockReturnValue(makeQuery([initWithTools([sdkTool]), successMessage]));

    await expect(
      claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      ),
    ).resolves.toEqual({response: 'done'});

    expect(warnLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_catalog_unavailable',
        failureReason: 'catalog_resolution',
        errorClass: 'unknown',
      }),
      'Claude integration tool catalog could not be resolved before invocation',
    );
    expect(JSON.stringify(warnLog.mock.calls)).not.toContain('do-not-log');
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'advertised_tool_not_invoked',
        catalogFailures: [
          {
            server: 'shipfox_integration_tools',
            reason: 'catalog_resolution',
            errorClass: 'unknown',
          },
        ],
        omissions: [],
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a catalog connection-policy failure separately', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const error = Object.assign(new Error('gateway denied access'), {code: 403});
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    const bridge = mcpBridge([], {
      listTools: vi.fn().mockRejectedValue(error),
    });
    queryMock.mockReturnValue(makeQuery([initWithTools([]), successMessage]));

    await expect(
      claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      ),
    ).resolves.toEqual({response: 'done'});

    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'requested_tool_omitted',
        catalogFailures: [
          {
            server: 'shipfox_integration_tools',
            reason: 'connection_policy',
            errorClass: 'http',
            errorStatus: 403,
          },
        ],
        omissions: [{toolName: integrationTool, reason: 'connection_policy'}],
      }),
      'Claude integration tool outcome',
    );
  });

  it('does not retain a catalog omission after Claude advertises and calls the tool', async () => {
    const availableTool = 'linear_shipfox__get_team';
    const missingFromCatalog = 'slack_shipfox__read_channel';
    const availableSdkTool = `mcp__shipfox_integration_tools__${availableTool}`;
    const missingSdkTool = `mcp__shipfox_integration_tools__${missingFromCatalog}`;
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    const bridge = mcpBridge([availableTool]);
    queryMock.mockReturnValue(
      makeQuery([
        initWithTools([availableSdkTool, missingSdkTool]),
        assistantToolUse(missingSdkTool, 'catalog-miss-call'),
        userToolResult('catalog-miss-call', true),
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['provider rejected the integration call'],
        },
      ]),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        requestedIntegrationTools: [
          {connectionSlug: 'linear_shipfox', toolId: 'get_team'},
          {connectionSlug: 'slack_shipfox', toolId: 'read_channel'},
        ],
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_invocation_failed',
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'integration_tool_invocation_failed',
        failedIntegrationToolNames: [missingFromCatalog],
        omissions: [],
      }),
      'Claude integration tool outcome',
    );
  });

  it('continues after a catalog lookup timeout', async () => {
    vi.useFakeTimers();
    try {
      const integrationTool = 'linear_shipfox__get_team';
      const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
      const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
      const warnLog = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
      let releaseListStarted: () => void = () => undefined;
      const listStarted = new Promise<void>((resolve) => {
        releaseListStarted = resolve;
      });
      const bridge = mcpBridge([], {
        listTools: vi.fn().mockImplementation(() => {
          releaseListStarted();
          return new Promise(() => undefined);
        }),
      });
      queryMock.mockReturnValue(makeQuery([initWithTools([sdkTool]), successMessage]));

      const result = claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      );
      await listStarted;
      const expectation = expect(result).resolves.toEqual({response: 'done'});

      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;

      expect(warnLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'runner.agent_claude_tool_catalog_unavailable',
          failureReason: 'catalog_resolution',
          errorClass: 'timeout',
        }),
        'Claude integration tool catalog could not be resolved before invocation',
      );
      expect(infoLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'runner.agent_claude_tool_outcome',
          catalogFailures: [
            {
              server: 'shipfox_integration_tools',
              reason: 'catalog_resolution',
              errorClass: 'timeout',
            },
          ],
        }),
        'Claude integration tool outcome',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds bridge activation before Claude starts', async () => {
    vi.useFakeTimers();
    try {
      const integrationTool = 'linear_shipfox__get_team';
      const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
      let releaseActivationStarted: () => void = () => undefined;
      const activationStarted = new Promise<void>((resolve) => {
        releaseActivationStarted = resolve;
      });
      const bridge = mcpBridge([], {
        activateHttp: vi.fn().mockImplementation(() => {
          releaseActivationStarted();
          return new Promise(() => undefined);
        }),
      });

      const result = claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      );
      await activationStarted;
      const expectation = expect(result).rejects.toMatchObject({
        name: 'AgentInvocationError',
        failurePhase: 'requested_tool_omitted',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      await expectation;
      expect(queryMock).not.toHaveBeenCalled();
      expect(infoLog).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'runner.agent_claude_tool_outcome',
          omissions: [{toolName: integrationTool, reason: 'runner_capability'}],
        }),
        'Claude integration tool outcome',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a pending catalog lookup before starting Claude', async () => {
    const ac = new AbortController();
    let releaseListStarted: () => void = () => undefined;
    const listStarted = new Promise<void>((resolve) => {
      releaseListStarted = resolve;
    });
    const bridge = mcpBridge([], {
      listTools: vi.fn().mockImplementation(() => {
        releaseListStarted();
        return new Promise(() => undefined);
      }),
    });

    const result = claudeHarnessAdapter.run(
      invocation({
        signal: ac.signal,
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
      }),
    );
    await listStarted;
    ac.abort();

    await expect(result).rejects.toThrow(ABORT_ERROR_PATTERN);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('resolves and advertises Linear and Slack tools with safe invocation diagnostics', async () => {
    const linearTool = 'linear_shipfox__get_team';
    const slackTool = 'slack_shipfox__read_channel';
    const linearSdkTool = `mcp__shipfox_integration_tools__${linearTool}`;
    const slackSdkTool = `mcp__shipfox_integration_tools__${slackTool}`;
    const bridge = mcpBridge([linearTool, slackTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockImplementation((params: {options: Record<string, unknown>}) => {
      const servers = params.options.mcpServers as
        | Record<string, {tools?: Array<{handler?: (args: unknown) => Promise<unknown>}>}>
        | undefined;
      const outputHandler = servers?.shipfox_outputs?.tools?.[0]?.handler;
      const outputReady =
        outputHandler === undefined
          ? Promise.resolve()
          : outputHandler({key: 'summary', value: 'saved'});
      return makeQueryAfter(outputReady, [
        initWithTools([linearSdkTool, slackSdkTool, 'mcp__shipfox_outputs__set_output']),
        assistantToolUse(linearSdkTool, 'linear-call'),
        assistantToolUse(slackSdkTool, 'slack-call'),
        userToolResult('linear-call'),
        userToolResult('slack-call'),
        successMessage,
      ]);
    });

    const result = await claudeHarnessAdapter.run(
      invocation({
        jobExecutionId: 'job-1',
        stepId: 'step-1',
        attempt: 2,
        tools: ['Read'],
        mcpServers: [bridge],
        requestedIntegrationTools: [
          {connectionSlug: 'linear_shipfox', toolId: 'get_team'},
          {connectionSlug: 'slack_shipfox', toolId: 'read_channel'},
        ],
        outputs: {summary: {type: 'string'}},
      }),
    );

    expect(result).toEqual({response: 'done', outputs: {summary: 'saved'}});
    expect(lastQueryOptions()).toMatchObject({
      tools: ['Read', linearSdkTool, slackSdkTool, 'mcp__shipfox_outputs__set_output'],
      mcpServers: {
        shipfox_integration_tools: {
          type: 'http',
          url: 'http://127.0.0.1:43123/mcp',
          alwaysLoad: true,
        },
      },
    });
    expect(vi.mocked(bridge.activateHttp)).toHaveBeenCalledWith({
      authToken: expect.any(String),
      signal: expect.any(AbortSignal),
      timeout: 10_000,
    });
    expect(vi.mocked(bridge.listTools)).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      timeout: 10_000,
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_manifest',
        jobExecutionId: 'job-1',
        stepId: 'step-1',
        attempt: 2,
        requestedIntegrationToolIds: [linearTool, slackTool],
        resolvedIntegrationToolNames: [linearTool, slackTool],
        sdkToolNames: [linearSdkTool, slackSdkTool],
        omissions: [],
      }),
      'Claude integration tool manifest',
    );
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'none',
        outputGate: 'passed',
        advertisementObserved: true,
        advertisedIntegrationToolNames: [linearTool, slackTool],
        attemptedIntegrationToolNames: [linearTool, slackTool],
        failedIntegrationToolNames: [],
      }),
      'Claude integration tool outcome',
    );
    const logged = JSON.stringify(infoLog.mock.calls);
    expect(logged).not.toContain('sk-runtime-secret');
    expect(logged).not.toContain('not logged');
    expect(logged).not.toContain('tool response is not logged');
  });

  it('distinguishes an advertised integration tool that Claude declines to invoke', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(makeQuery([initWithTools([sdkTool]), successMessage]));

    await expect(
      claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      ),
    ).resolves.toEqual({response: 'done'});

    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'advertised_tool_not_invoked',
        outputGate: 'not_required',
        advertisedIntegrationToolNames: [integrationTool],
        attemptedIntegrationToolNames: [],
        omissions: [],
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a missing Claude SDK advertisement separately from a declined call', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(makeQuery([initWithTools(['Read']), successMessage]));

    await expect(
      claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      ),
    ).resolves.toEqual({response: 'done'});

    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'requested_tool_omitted',
        omissions: [{toolName: integrationTool, reason: 'sdk_registration'}],
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a successful result without an SDK tool list as an SDK registration omission', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(makeQuery([initMessage, successMessage]));

    await expect(
      claudeHarnessAdapter.run(
        invocation({
          mcpServers: [bridge],
          requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        }),
      ),
    ).resolves.toEqual({response: 'done'});

    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'requested_tool_omitted',
        advertisementObserved: true,
        omissions: [{toolName: integrationTool, reason: 'sdk_registration'}],
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a failed integration invocation and carries its phase on the error', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(
      makeQuery([
        initWithTools([sdkTool]),
        assistantToolUse(sdkTool, 'failed-call'),
        userToolResult('failed-call', true),
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['provider rejected the integration call'],
        },
      ]),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_invocation_failed',
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'integration_tool_invocation_failed',
        attemptedIntegrationToolNames: [integrationTool],
        failedIntegrationToolNames: [integrationTool],
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a failed tool_progress integration invocation', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(
      makeQuery([
        initWithTools([sdkTool]),
        toolProgress(sdkTool, 'progress-call'),
        userToolResult('progress-call', true),
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['provider rejected the integration call'],
        },
      ]),
    );

    const result = claudeHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'integration_tool_invocation_failed',
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        attemptedIntegrationToolNames: [integrationTool],
        failedIntegrationToolNames: [integrationTool],
        failurePhase: 'integration_tool_invocation_failed',
      }),
      'Claude integration tool outcome',
    );
  });

  it('classifies a missing structured output as an output-gate failure', async () => {
    const integrationTool = 'slack_shipfox__read_channel';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const bridge = mcpBridge([integrationTool]);
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    queryMock.mockReturnValue(makeQuery([successMessage, successMessage, successMessage]));

    const result = claudeHarnessAdapter.run(
      invocation({
        tools: ['Read'],
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'slack_shipfox', toolId: 'read_channel'}],
        outputs: {summary: {type: 'string'}},
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentInvocationError',
      failurePhase: 'output_gate_failed',
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'output_gate_failed',
        outputGate: 'failed',
        requiredOutputCount: 1,
        missingOutputCount: 1,
      }),
      'Claude integration tool outcome',
    );
    expect(lastQueryOptions().tools).toEqual(['Read', sdkTool, 'mcp__shipfox_outputs__set_output']);
  });

  it('hydrates and persists a resumed Claude session through the SDK session store', async () => {
    const transcriptFile = join(testCwd, 'downloaded-session.jsonl');
    writeFileSync(transcriptFile, '{"type":"user","uuid":"prior"}\n');
    queryMock.mockImplementation((params: {options: {sessionStore?: TestSessionStore}}) => {
      void params.options.sessionStore?.append(
        {projectKey: 'project', sessionId: 'prior-session-id'},
        [{type: 'assistant', uuid: 'next', message: {content: []}}],
      );
      return makeQuery([{...initMessage, session_id: 'prior-session-id'}, successMessage]);
    });

    const result = await claudeHarnessAdapter.run(
      invocation({
        session: {
          mode: 'resume',
          file: transcriptFile,
          harnessSessionId: 'prior-session-id',
        },
      }),
    );

    expect(result).toMatchObject({
      response: 'done',
      sessionFile: transcriptFile,
      sessionId: 'prior-session-id',
    });
    expect(readFileSync(transcriptFile, 'utf8')).toBe(
      '{"type":"user","uuid":"prior"}\n{"type":"assistant","uuid":"next","message":{"content":[]}}\n',
    );
    expect(lastQueryOptions()).toMatchObject({
      persistSession: true,
      sessionStoreFlush: 'batched',
      settingSources: [],
      resume: 'prior-session-id',
    });
    expect(lastQueryOptions()).not.toHaveProperty('forkSession');
    expect(lastQueryOptions().sessionStore).toBeDefined();
    expect(lastQueryOptions().env.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(existsSync(lastQueryOptions().env.CLAUDE_CONFIG_DIR as string)).toBe(false);
  });

  it('does not classify post-turn session persistence failures as tool failures', async () => {
    const integrationTool = 'linear_shipfox__get_team';
    const sdkTool = `mcp__shipfox_integration_tools__${integrationTool}`;
    const transcriptFile = join(testCwd, 'downloaded-session.jsonl');
    const infoLog = vi.spyOn(logger(), 'info').mockImplementation(() => undefined);
    writeFileSync(transcriptFile, '{"type":"user","uuid":"prior"}\n');
    const bridge = mcpBridge([integrationTool]);
    queryMock.mockImplementation((params: {options: {sessionStore?: TestSessionStore}}) => {
      rmSync(transcriptFile);
      mkdirSync(transcriptFile);
      void params.options.sessionStore?.append(
        {projectKey: 'project', sessionId: 'prior-session-id'},
        [{type: 'assistant', uuid: 'next', message: {content: []}}],
      );
      return makeQuery([
        {...initWithTools([sdkTool]), session_id: 'prior-session-id'},
        assistantToolUse(sdkTool, 'successful-call'),
        userToolResult('successful-call'),
        successMessage,
      ]);
    });

    const result = claudeHarnessAdapter.run(
      invocation({
        mcpServers: [bridge],
        requestedIntegrationTools: [{connectionSlug: 'linear_shipfox', toolId: 'get_team'}],
        session: {
          mode: 'resume',
          file: transcriptFile,
          harnessSessionId: 'prior-session-id',
        },
      }),
    );

    await expect(result).rejects.toMatchObject({
      name: 'AgentSessionUnavailableError',
    });
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.agent_claude_tool_outcome',
        failurePhase: 'none',
        attemptedIntegrationToolNames: [integrationTool],
        failedIntegrationToolNames: [],
      }),
      'Claude integration tool outcome',
    );
  });

  it('creates and persists a fresh Claude resume session', async () => {
    queryMock.mockImplementation((params: {options: {sessionStore?: TestSessionStore}}) => {
      void params.options.sessionStore?.append({projectKey: 'project', sessionId: 'session-1'}, [
        {type: 'user', uuid: 'first', message: {content: 'Fix it.'}},
      ]);
      return makeQuery([initMessage, successMessage]);
    });

    const result = await claudeHarnessAdapter.run(invocation({session: {mode: 'resume'}}));

    expect(result).toMatchObject({
      response: 'done',
      sessionFile: join(testCwd, 'runner-agent', 'sessions', 'claude-session.jsonl'),
      sessionId: 'session-1',
    });
    expect(readFileSync(result.sessionFile as string, 'utf8')).toBe(
      '{"type":"user","uuid":"first","message":{"content":"Fix it."}}\n',
    );
    expect(lastQueryOptions()).toMatchObject({
      persistSession: true,
      settingSources: [],
    });
    expect(lastQueryOptions()).not.toHaveProperty('resume');
  });

  it('resumes a Claude fork without committing it', async () => {
    const transcriptFile = join(testCwd, 'downloaded-session.jsonl');
    writeFileSync(transcriptFile, '{"type":"user","uuid":"prior"}\n');
    queryMock.mockReturnValue(makeQuery([initMessage, successMessage]));

    const result = await claudeHarnessAdapter.run(
      invocation({
        session: {
          mode: 'fork',
          file: transcriptFile,
          harnessSessionId: 'prior-session-id',
        },
      }),
    );

    expect(result).toEqual({response: 'done'});
    expect(lastQueryOptions()).toMatchObject({
      persistSession: true,
      resume: 'prior-session-id',
      forkSession: true,
    });
    expect(readFileSync(transcriptFile, 'utf8')).toBe('{"type":"user","uuid":"prior"}\n');
  });

  it('rejects a resumed Claude transcript without its native session id', async () => {
    const transcriptFile = join(testCwd, 'downloaded-session.jsonl');
    writeFileSync(transcriptFile, '{"type":"user","uuid":"prior"}\n');

    const result = claudeHarnessAdapter.run(
      invocation({session: {mode: 'resume', file: transcriptFile}}),
    );

    await expect(result).rejects.toThrow(
      'Claude could not load the agent session: the transcript has no native session id',
    );
    expect(queryMock).not.toHaveBeenCalled();
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
