import {type Context, complete, type Model} from '@earendil-works/pi-ai/compat';
import type {
  AgentRuntimeCredentialsResponseDto,
  ManagedModelApi,
  ManagedModelProvider,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {deleteModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {setSecrets} from '#test/fixtures/secrets-client.js';
import {agentSystemNamespace, customCredentialsToStoreValues} from './credential-fingerprints.js';
import {ModelProviderConfigNotFoundError} from './errors.js';
import {resolveRuntimeCredentials} from './resolve-runtime-credentials.js';

const managedGatewayBaseUrlVariants = [
  'https://gateway.example.test/inference',
  'https://gateway.example.test/inference/',
  'https://gateway.example.test/inference/v1',
  'https://gateway.example.test/inference/v1/',
  'https://gateway.example.test/inference/v1/?tenant=staging#runtime',
] as const;

const expectedPiRequestUrls = {
  'openai-responses': [
    'https://gateway.example.test/inference/v1/responses',
    'https://gateway.example.test/inference/v1/responses',
    'https://gateway.example.test/inference/v1/responses',
    'https://gateway.example.test/inference/v1/responses',
    'https://gateway.example.test/inference/v1/responses',
  ],
  'openai-completions': [
    'https://gateway.example.test/inference/v1/chat/completions',
    'https://gateway.example.test/inference/v1/chat/completions',
    'https://gateway.example.test/inference/v1/chat/completions',
    'https://gateway.example.test/inference/v1/chat/completions',
    'https://gateway.example.test/inference/v1/chat/completions',
  ],
  'anthropic-messages': [
    'https://gateway.example.test/inference/v1/messages',
    'https://gateway.example.test/inference/v1/messages',
    'https://gateway.example.test/inference/v1/messages',
    'https://gateway.example.test/inference/v1/messages',
    'https://gateway.example.test/inference/v1/messages',
  ],
} satisfies Record<ManagedModelApi, readonly string[]>;

describe('resolveRuntimeCredentials', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('returns decrypted workspace credentials', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });

    const result = await resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    expect(result).toEqual({
      harness: 'pi',
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'sk-workspace-secret'},
    });
  });

  it('resolves managed provider credentials into the pi custom provider contract', async () => {
    const runId = crypto.randomUUID();
    const stepAttemptId = crypto.randomUUID();
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'openai-responses',
      baseUrl: 'https://gateway.example.test/inference/',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId,
        stepAttemptId,
        harness: 'pi',
        provider: 'shipfox',
        model: 'responses-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(resolveCredentials).toHaveBeenCalledWith({
      workspaceId,
      runId,
      stepAttemptId,
      model: 'responses-model',
    });
    expect(result).toEqual({
      harness: 'pi',
      provider_id: 'shipfox',
      model: 'responses-model',
      thinking: 'high',
      credentials: {api_key: 'managed-token'},
      custom_provider: {
        api: 'openai-responses',
        base_url: 'https://gateway.example.test/inference/v1',
        headers: [],
        secret_header_names: [],
        models: [
          {
            id: 'responses-model',
            label: 'Responses model',
            context_window: 1_000_000,
            max_output_tokens: 65_536,
            reasoning: true,
            input_image: true,
            thinking_level_map: {off: 'none', minimal: null, high: 'high'},
            compat: {
              supportsDeveloperRole: true,
              supportsStrictMode: true,
              supportsToolSearch: true,
            },
          },
        ],
        requires_api_key: true,
      },
    });
  });

  it('omits optional model metadata when the managed model entry does not carry it', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'openai-completions',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'shipfox',
        model: 'plain-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result).toEqual({
      harness: 'pi',
      provider_id: 'shipfox',
      model: 'plain-model',
      thinking: 'high',
      credentials: {api_key: 'managed-token'},
      custom_provider: {
        api: 'openai-completions',
        base_url: 'https://gateway.example.test/inference/v1',
        headers: [],
        secret_header_names: [],
        models: [{id: 'plain-model', label: 'Plain model'}],
        requires_api_key: true,
      },
    });
  });

  it('forwards partial managed model metadata, including false values', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'openai-completions',
      baseUrl: 'https://gateway.example.test',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'shipfox',
        model: 'partial-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result.custom_provider?.models).toEqual([
      {
        id: 'partial-model',
        label: 'Partial model',
        max_output_tokens: 8_192,
        reasoning: false,
        input_image: false,
      },
    ]);
  });

  it('falls back to an unregistered managed model descriptor', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'openai-completions',
      baseUrl: 'https://gateway.example.test',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'shipfox',
        model: 'missing-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result.custom_provider?.models).toEqual([{id: 'missing-model', label: 'missing-model'}]);
  });

  it('resolves managed provider credentials into the Claude per-step contract', async () => {
    const runId = crypto.randomUUID();
    const stepAttemptId = crypto.randomUUID();
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId,
        stepAttemptId,
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(resolveCredentials).toHaveBeenCalledWith({
      workspaceId,
      runId,
      stepAttemptId,
      model: 'claude-model',
    });
    expect(result).toEqual({
      harness: 'claude',
      provider_id: 'shipfox',
      model: 'claude-haiku-4-5',
      thinking: 'high',
      credentials: {api_key: 'managed-token'},
      claude: {
        base_url: 'https://gateway.example.test/inference',
        auth_token: 'managed-token',
      },
    });
  });

  it('maps managed renewable credential metadata into the runtime response', async () => {
    const expiresAt = new Date('2026-06-10T12:00:00.000Z');
    const refreshAt = new Date('2026-06-10T11:55:00.000Z');
    const generation = '11111111-1111-4111-8111-111111111111';
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
      expiresAt,
      generation,
      renewal: {mode: 'refresh-at', refreshAt},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result).toMatchObject({
      expires_at: expiresAt.toISOString(),
      generation,
      renewal: {mode: 'refresh-at', refresh_at: refreshAt.toISOString()},
    });
  });

  it('maps managed on-rejection credential metadata into the runtime response', async () => {
    const expiresAt = new Date('2026-06-10T12:00:00.000Z');
    const generation = '11111111-1111-4111-8111-111111111111';
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
      expiresAt,
      generation,
      renewal: {mode: 'on-rejection'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result).toMatchObject({
      expires_at: expiresAt.toISOString(),
      generation,
      renewal: {mode: 'on-rejection'},
    });
  });

  it('omits incomplete managed renewable credential metadata', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
      generation: '11111111-1111-4111-8111-111111111111',
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result).not.toHaveProperty('expires_at');
    expect(result).not.toHaveProperty('generation');
    expect(result).not.toHaveProperty('renewal');
  });

  it('keeps the catalog model ID when a managed model has no Claude model ID', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test/inference/v1/',
      credentials: {api_key: 'managed-token'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'unmapped-claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result.model).toBe('unmapped-claude-model');
  });

  it.each([
    {api: 'openai-responses', model: 'responses-model'},
    {api: 'openai-completions', model: 'plain-model'},
    {api: 'anthropic-messages', model: 'claude-model'},
  ] satisfies readonly {
    api: ManagedModelApi;
    model: string;
  }[])('composes the $api runtime response with the real Pi client URL construction', async ({
    api,
    model,
  }) => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('capture request'));
    for (const baseUrl of managedGatewayBaseUrlVariants) {
      resolveCredentials.mockResolvedValueOnce({
        api,
        baseUrl,
        credentials: {api_key: 'opaque-test-credential'},
      });
      const runtime = await resolveRuntimeCredentials(
        {
          workspaceId,
          runId: crypto.randomUUID(),
          stepAttemptId: crypto.randomUUID(),
          harness: 'pi',
          provider: 'shipfox',
          model,
          thinking: 'high',
        },
        {managedProvider: managedProvider(resolveCredentials)},
      );

      expect(runtime.model).toBe(model);
      const apiKey = runtime.credentials.api_key;
      if (apiKey === undefined) {
        throw new Error('Expected managed Pi API key');
      }
      await complete(toPiModel(runtime), piContext(), {
        apiKey,
        maxRetries: 0,
      });
    }

    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual(expectedPiRequestUrls[api]);
  });

  it.each([
    {
      baseUrl: managedGatewayBaseUrlVariants[0],
      expected: 'https://gateway.example.test/inference',
    },
    {
      baseUrl: managedGatewayBaseUrlVariants[1],
      expected: 'https://gateway.example.test/inference',
    },
    {
      baseUrl: managedGatewayBaseUrlVariants[2],
      expected: 'https://gateway.example.test/inference',
    },
    {
      baseUrl: managedGatewayBaseUrlVariants[3],
      expected: 'https://gateway.example.test/inference',
    },
    {
      baseUrl: managedGatewayBaseUrlVariants[4],
      expected: 'https://gateway.example.test/inference',
    },
  ])('normalizes the Claude client base URL for %s', async ({baseUrl, expected}) => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl,
      credentials: {api_key: 'opaque-test-credential'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result.claude?.base_url).toBe(expected);
  });

  it('uses Claude client URL semantics when a managed lease reports another API dialect', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'openai-responses',
      baseUrl: 'https://gateway.example.test/inference',
      credentials: {api_key: 'opaque-test-credential'},
    });

    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'claude',
        provider: 'shipfox',
        model: 'claude-model',
        thinking: 'high',
      },
      {managedProvider: managedProvider(resolveCredentials)},
    );

    expect(result.claude?.base_url).toBe('https://gateway.example.test/inference');
  });

  it('prefers workspace credentials over the instance fallback', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });
    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );

    expect(result.credentials).toEqual({api_key: 'sk-workspace-secret'});
  });

  it('returns the instance fallback only for the instance default model provider', async () => {
    const matching = await resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );
    const mismatched = resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );

    expect(matching.credentials).toEqual({api_key: 'sk-instance-secret'});
    await expect(mismatched).rejects.toMatchObject({name: 'ModelProviderConfigNotFoundError'});
  });

  it('refuses workspace credentials and instance fallback when workspace providers are disabled', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });

    const result = resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {
        workspaceProviders: 'disabled',
        runtimeConfig: instanceConfig(),
      },
    );

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('reports the managed provider when a foreign runtime provider is requested', async () => {
    const result = resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {
        workspaceProviders: 'disabled',
        managedProvider: managedProvider(vi.fn()),
      },
    );

    await expect(result).rejects.toMatchObject({
      name: 'WorkspaceProvidersDisabledError',
      managedProviderId: 'shipfox',
    });
  });

  it('returns custom provider runtime descriptors for custom rows', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: [{name: 'x-region', value: 'local'}],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      requiresApiKey: true,
      credentials: {api_key: 'sk-local-secret', 'header:authorization': 'Bearer local'},
    });

    const result = await resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'high',
    });

    expect(result).toEqual({
      harness: 'pi',
      provider_id: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'high',
      credentials: {api_key: 'sk-local-secret', 'header:authorization': 'Bearer local'},
      custom_provider: {
        api: 'openai-responses',
        base_url: 'http://127.0.0.1:11434/v1',
        headers: [{name: 'x-region', value: 'local'}],
        secret_header_names: ['authorization'],
        models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        requires_api_key: true,
      },
    });
  });

  it('returns keyless custom provider runtime descriptors for keyless custom rows', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'local-ollama',
      kind: 'custom',
      displayName: 'Local Ollama',
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: [],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      requiresApiKey: false,
      credentials: {},
    });

    const result = await resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'local-ollama',
      model: 'llama-3.1',
      thinking: 'high',
    });

    expect(result).toMatchObject({
      provider_id: 'local-ollama',
      credentials: {},
      custom_provider: {
        requires_api_key: false,
      },
    });
  });

  it('throws when no workspace or instance credential is available', async () => {
    const result = resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('throws after a workspace credential is deleted', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });
    await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const result = resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('throws when a configured row has no secret bag', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('throws when a multi-field provider secret bag is incomplete', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('cloudflare-ai-gateway'),
      values: {API_KEY: 'cf-secret'},
    });
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'cloudflare-ai-gateway',
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'cloudflare-ai-gateway',
      model: '@cf/meta/llama-3.1-8b-instruct',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('does not resolve an orphaned secret without a provider config row', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'sk-orphaned-secret'},
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('does not expose credential material on store decryption errors', async () => {
    const error = new Error('Secret decryption failed');
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials(
      {
        workspaceId,
        runId: crypto.randomUUID(),
        stepAttemptId: crypto.randomUUID(),
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {getCredentialBag: vi.fn().mockRejectedValue(error)},
    );

    await expect(result).rejects.toBe(error);
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain('sk-workspace-secret');
    }
  });
});

function piContext(): Context {
  return {
    messages: [{role: 'user', content: 'Reply with OK.', timestamp: 0}],
  };
}

function toPiModel(response: AgentRuntimeCredentialsResponseDto): Model<ManagedModelApi> {
  const customProvider = response.custom_provider;
  if (customProvider === undefined) {
    throw new Error('Expected managed Pi custom provider');
  }
  const model = customProvider.models[0];
  if (model === undefined) {
    throw new Error('Expected managed Pi model');
  }
  if (customProvider.api === 'google-generative-ai') {
    throw new Error('Expected a managed Pi API dialect');
  }

  return {
    id: response.model,
    name: model.label,
    api: customProvider.api,
    provider: response.provider_id,
    baseUrl: customProvider.base_url,
    reasoning: model.reasoning ?? false,
    input: model.input_image === true ? ['text', 'image'] : ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: model.context_window ?? 1_000_000,
    maxTokens: model.max_output_tokens ?? 65_536,
  };
}

async function saveProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
  kind?: 'builtin' | 'custom' | undefined;
  displayName?: string | undefined;
  api?: 'openai-responses' | undefined;
  baseUrl?: string | undefined;
  headers?: {name: string; value: string}[] | undefined;
  models?: {id: string; label: string}[] | undefined;
  requiresApiKey?: boolean | undefined;
  credentials: Record<string, string>;
}) {
  await setSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
    values:
      params.kind === 'custom'
        ? customCredentialsToStoreValues(params.credentials)
        : {API_KEY: params.credentials.api_key ?? ''},
  });
  return await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    kind: params.kind,
    displayName: params.displayName,
    api: params.api,
    baseUrl: params.baseUrl,
    headers: params.headers,
    models: params.models,
    requiresApiKey: params.requiresApiKey,
    defaultModel: null,
    defaultThinking: 'high',
  });
}

function instanceConfig() {
  return {
    AGENT_DEFAULT_PROVIDER: 'anthropic' as const,
    AGENT_DEFAULT_PROVIDER_API_KEY: 'sk-instance-secret',
  };
}

function managedProvider(
  resolveCredentials: ManagedModelProvider['resolveCredentials'],
): ManagedModelProvider {
  return {
    id: 'shipfox',
    label: 'Shipfox',
    models: [
      {
        id: 'claude-model',
        label: 'Claude model',
        api: 'anthropic-messages',
        claudeModelId: 'claude-haiku-4-5',
      },
      {
        id: 'unmapped-claude-model',
        label: 'Unmapped Claude model',
        api: 'anthropic-messages',
      },
      {
        id: 'responses-model',
        label: 'Responses model',
        api: 'openai-responses',
        context_window: 1_000_000,
        max_output_tokens: 65_536,
        reasoning: true,
        input_image: true,
        thinkingLevelMap: {off: 'none', minimal: null, high: 'high'},
        compat: {
          supportsDeveloperRole: true,
          supportsStrictMode: true,
          supportsToolSearch: true,
        },
      },
      {
        id: 'partial-model',
        label: 'Partial model',
        api: 'openai-completions',
        max_output_tokens: 8_192,
        reasoning: false,
        input_image: false,
      },
      {id: 'plain-model', label: 'Plain model', api: 'openai-completions'},
    ],
    defaultModel: 'responses-model',
    resolveCredentials,
  };
}
