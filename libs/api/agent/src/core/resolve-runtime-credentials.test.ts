import type {ManagedModelProvider, ModelProviderRef} from '@shipfox/api-agent-dto';
import {deleteModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {setSecrets} from '#test/fixtures/secrets-client.js';
import {agentSystemNamespace, customCredentialsToStoreValues} from './credential-fingerprints.js';
import {ModelProviderConfigNotFoundError} from './errors.js';
import {resolveRuntimeCredentials} from './resolve-runtime-credentials.js';

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
      baseUrl: 'https://gateway.example.test',
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
        base_url: 'https://gateway.example.test',
        headers: [],
        secret_header_names: [],
        models: [{id: 'responses-model', label: 'Responses model'}],
        requires_api_key: true,
      },
    });
  });

  it('resolves managed provider credentials into the Claude per-step contract', async () => {
    const resolveCredentials = vi.fn<ManagedModelProvider['resolveCredentials']>();
    resolveCredentials.mockResolvedValue({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.test',
      credentials: {api_key: 'managed-token'},
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

    expect(result).toEqual({
      harness: 'claude',
      provider_id: 'shipfox',
      model: 'claude-model',
      thinking: 'high',
      credentials: {api_key: 'managed-token'},
      claude: {
        base_url: 'https://gateway.example.test',
        auth_token: 'managed-token',
      },
    });
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
      {id: 'claude-model', label: 'Claude model', api: 'anthropic-messages'},
      {id: 'responses-model', label: 'Responses model', api: 'openai-responses'},
    ],
    defaultModel: 'responses-model',
    resolveCredentials,
  };
}
