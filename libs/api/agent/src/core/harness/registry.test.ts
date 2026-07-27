import type {AssistantMessage, Context, ProviderStreamOptions} from '@earendil-works/pi-ai';
import {getModels} from '@earendil-works/pi-ai/compat';
import {
  claudeAgentThinkingSchema,
  harnessSchema,
  piAgentThinkingSchema,
} from '@shipfox/api-agent-dto';
import {
  getHarnessDescriptor as getCoreHarnessDescriptor,
  listHarnessProviderModels as listCoreHarnessProviderModels,
  ModelProviderValidationError,
  UnsupportedHarnessProviderError,
} from '#core/index.js';
import {CLAUDE_HARNESS, CLAUDE_MODEL_LINE} from './claude.js';
import {PI_HARNESS} from './pi.js';
import {
  getHarnessDescriptor,
  harnessSupportsProvider,
  listHarnessDescriptors,
  listHarnessProviderModels,
  probeHarnessProviderCredentials,
} from './registry.js';

const piAi = vi.hoisted(() => ({
  complete: vi.fn(),
  getModels: vi.fn(),
}));

const metrics = vi.hoisted(() => ({
  modelProviderValidationCount: {
    add: vi.fn(),
  },
}));

vi.mock('@earendil-works/pi-ai/compat', () => piAi);
vi.mock('#metrics/index.js', () => metrics);

describe('harness registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    piAi.getModels.mockImplementation((providerId: string) =>
      providerId === 'anthropic' ? anthropicModels() : [],
    );
    piAi.complete.mockResolvedValue(createAssistantMessage());
  });

  it('returns the pi and Claude descriptors', () => {
    expect(getHarnessDescriptor('pi')).toEqual({
      id: 'pi',
      label: 'pi',
      description: 'Works with 30+ model providers',
      supportedProviderIds: expect.arrayContaining(['anthropic', 'openai']),
      thinkingLevels: piAgentThinkingSchema.options,
      defaultThinking: 'xhigh',
      defaultProviderId: 'anthropic',
      tools: expect.arrayContaining([
        expect.objectContaining({name: 'read'}),
        expect.objectContaining({name: 'web_search'}),
      ]),
    });
    expect(getHarnessDescriptor('claude')).toEqual({
      id: 'claude',
      label: 'Claude',
      description: 'Runs on your Anthropic API key',
      supportedProviderIds: ['anthropic'],
      thinkingLevels: claudeAgentThinkingSchema.options,
      defaultThinking: 'xhigh',
      defaultProviderId: 'anthropic',
      tools: expect.arrayContaining([
        expect.objectContaining({name: 'Read'}),
        expect.objectContaining({name: 'WebSearch'}),
      ]),
    });
    expect(listHarnessDescriptors().map((descriptor) => descriptor.id)).toEqual(['pi', 'claude']);
  });

  it('registers every harness declared by the shared schema', () => {
    const registeredHarnessIds = listHarnessDescriptors().map((descriptor) => descriptor.id);

    expect(registeredHarnessIds).toEqual(harnessSchema.options);
  });

  it('keeps harness descriptor invariants synced with their source registries', () => {
    const anthropicModelIds = new Set(getModels('anthropic').map((model) => model.id));
    const unknownClaudeModelIds = CLAUDE_MODEL_LINE.filter(
      (model) => !anthropicModelIds.has(model.id),
    ).map((model) => model.id);

    expect(PI_HARNESS.thinkingLevels).toBe(piAgentThinkingSchema.options);
    expect(CLAUDE_HARNESS.defaultThinking).toBe('xhigh');
    expect(unknownClaudeModelIds).toEqual([]);
  });

  it('lists pi provider models from pi-ai', () => {
    const models = listHarnessProviderModels('pi', 'anthropic');

    expect(piAi.getModels).toHaveBeenCalledWith('anthropic');
    expect(models).toContainEqual({id: 'claude-opus-4-8', label: 'Claude Opus 4.8'});
    expect(models).toContainEqual({id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (latest)'});
  });

  it('lists the Claude model line for Anthropic', () => {
    const models = listHarnessProviderModels('claude', 'anthropic');

    expect(models).toContainEqual({id: 'claude-opus-4-8', label: 'Claude Opus 4.8'});
    expect(models).toEqual(CLAUDE_MODEL_LINE);
  });

  it('rejects unsupported harness/provider pairs before entering the catalog', () => {
    expect(harnessSupportsProvider('claude', 'openai')).toBe(false);
    expect(() => listHarnessProviderModels('claude', 'openai')).toThrow(
      UnsupportedHarnessProviderError,
    );
  });

  it('exports the public seam through the core barrel', () => {
    expect(getCoreHarnessDescriptor('claude')).toBe(getHarnessDescriptor('claude'));
    expect(listCoreHarnessProviderModels('claude', 'anthropic')).toEqual(CLAUDE_MODEL_LINE);
  });

  it('probes pi credentials through pi-ai complete', async () => {
    await probeHarnessProviderCredentials({
      harness: 'pi',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    const [model, context, options] = piAi.complete.mock.calls[0] as [
      {id: string},
      Context,
      ProviderStreamOptions,
    ];
    expect(model.id).toBe('claude-opus-4-8');
    expect(context.messages).toHaveLength(1);
    expect(options).toMatchObject({apiKey: 'sk-ant-secret', maxRetries: 0});
    expect(metrics.modelProviderValidationCount.add).toHaveBeenCalledWith(1, {
      model_provider: 'anthropic',
      outcome: 'succeeded',
    });
  });

  it('wraps pi probe failures in sanitized validation errors', async () => {
    piAi.complete.mockResolvedValue(
      createAssistantMessage({
        stopReason: 'error',
        errorMessage: 'Authentication failed for sk-ant-secret',
      }),
    );

    const probe = probeHarnessProviderCredentials({
      harness: 'pi',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    await expect(probe).rejects.toMatchObject({
      providerId: 'anthropic',
      sanitizedMessage: expect.not.stringContaining('sk-ant-secret'),
    });
    await expect(probe).rejects.toThrow(ModelProviderValidationError);
  });

  it('probes Claude credentials against Anthropic messages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'));

    await probeHarnessProviderCredentials({
      harness: 'claude',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({method: 'POST', redirect: 'error'}),
    );
    expect((init.headers as Headers).get('x-api-key')).toBe('sk-ant-secret');
    expect((init.headers as Headers).get('anthropic-version')).toBe('2023-06-01');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'claude-opus-4-8',
      max_tokens: 64,
      messages: [{role: 'user', content: 'Reply with OK.'}],
    });
  });

  it('wraps Claude non-2xx responses as sanitized validation errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', {status: 401}));

    const probe = probeHarnessProviderCredentials({
      harness: 'claude',
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials: {api_key: 'sk-ant-secret'},
    });

    await expect(probe).rejects.toMatchObject({
      providerId: 'anthropic',
      sanitizedMessage: 'Provider returned HTTP 401.',
    });
    await expect(probe).rejects.toThrow(ModelProviderValidationError);
  });

  it('rejects unsupported probes before recording validation metrics', async () => {
    const probe = probeHarnessProviderCredentials({
      harness: 'claude',
      providerId: 'openai',
      model: 'gpt-5.5-pro',
      credentials: {api_key: 'sk-openai-secret'},
    });

    await expect(probe).rejects.toThrow(UnsupportedHarnessProviderError);
    expect(metrics.modelProviderValidationCount.add).not.toHaveBeenCalled();
  });
});

function anthropicModels() {
  return [
    {
      id: 'claude-opus-4-8',
      provider: 'anthropic',
      api: 'anthropic-messages',
      name: 'Claude Opus 4.8',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 200000,
      maxTokens: 32000,
    },
    {
      id: 'claude-haiku-4-5',
      provider: 'anthropic',
      api: 'anthropic-messages',
      name: 'Claude Haiku 4.5 (latest)',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 200000,
      maxTokens: 32000,
    },
    ...CLAUDE_MODEL_LINE.filter(
      (model) => model.id !== 'claude-opus-4-8' && model.id !== 'claude-haiku-4-5',
    ).map((model) => ({
      id: model.id,
      provider: 'anthropic',
      api: 'anthropic-messages',
      name: model.label,
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 200000,
      maxTokens: 32000,
    })),
  ];
}

function createAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [{type: 'text', text: 'OK'}],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
    },
    stopReason: 'stop',
    timestamp: Date.now(),
    ...overrides,
  };
}
