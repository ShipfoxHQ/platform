import crypto from 'node:crypto';
import type {AgentThinking, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {
  getAgentWorkspaceSettings,
  setDefaultHarness,
  setDefaultModelProvider,
  type UpsertModelProviderConfigParams,
  upsertModelProviderConfig,
} from '#db/index.js';
import {
  InvalidAgentModelError,
  UnsupportedHarnessProviderError,
  UnsupportedHarnessThinkingError,
  UnsupportedModelProviderError,
  WorkspaceProvidersDisabledError,
} from './errors.js';
import * as harnessCatalog from './harness/index.js';
import {catalogDefaultAgentResolver, resolveAgentConfig} from './resolve-agent-config.js';
import {createWorkspaceAgentDefaultsResolver} from './workspace-agent-defaults-resolver.js';

describe('resolveAgentConfig', () => {
  test('resolves model provider from explicit step, workspace, instance, then catalog default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
      [
        'google' as const,
        {defaultModel: 'gemini-3.1-pro-preview', defaultThinking: 'low' as const},
      ],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'google'},
      {
        workspaceDefaultProviderId: 'openai',
        workspaceProviderConfigs,
        instanceDefaultProvider: 'anthropic',
      },
    );
    const workspace = resolveAgentConfig(
      {},
      {workspaceDefaultProviderId: 'openai', workspaceProviderConfigs},
    );
    const instance = resolveAgentConfig({}, {instanceDefaultProvider: 'anthropic'});
    const catalog = resolveAgentConfig({});

    expect(explicit.provider).toBe('google');
    expect(workspace.provider).toBe('openai');
    expect(instance.provider).toBe('anthropic');
    expect(catalog.provider).toBe('anthropic');
  });

  test('resolves model from explicit step, workspace, instance match, then catalog default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
      ['anthropic' as const, {defaultModel: null, defaultThinking: 'low' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', model: 'gpt-5.5-pro'},
      {workspaceProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultModel: 'claude-opus-4-8',
      },
    );
    const workspaceLatest = resolveAgentConfig({provider: 'anthropic'}, {workspaceProviderConfigs});
    const catalog = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.model).toBe('gpt-5.5-pro');
    expect(workspace.model).toBe('gpt-5.5-pro');
    expect(instance.model).toBe('claude-opus-4-8');
    expect(workspaceLatest.model).toBe('claude-opus-5');
    expect(catalog.model).toBe('deepseek-v4-pro');
  });

  test('resolves custom provider models from workspace configs', () => {
    const workspaceProviderConfigs = new Map([
      [
        'local-vllm',
        {
          kind: 'custom' as const,
          defaultModel: null,
          defaultThinking: 'medium' as const,
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        },
      ],
    ]);

    const resolved = resolveAgentConfig(
      {provider: 'local-vllm'},
      {workspaceProviderConfigs, workspaceDefaultProviderId: 'local-vllm'},
    );
    const invalidModel = () =>
      resolveAgentConfig(
        {provider: 'local-vllm', model: 'missing-model'},
        {workspaceProviderConfigs},
      );

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'medium',
    });
    expect(invalidModel).toThrow(InvalidAgentModelError);
  });

  test('resolves managed provider models by harness API family', () => {
    const provider = managedProvider();
    const context = {managedProvider: provider};

    const pi = resolveAgentConfig({provider: 'shipfox', model: 'completion-model'}, context);
    const claude = resolveAgentConfig({harness: 'claude', provider: 'shipfox'}, context);
    const incompatible = () =>
      resolveAgentConfig(
        {harness: 'claude', provider: 'shipfox', model: 'responses-model'},
        context,
      );

    expect(pi).toEqual({
      harness: 'pi',
      provider: 'shipfox',
      model: 'completion-model',
      thinking: 'low',
    });
    expect(claude).toEqual({
      harness: 'claude',
      provider: 'shipfox',
      model: 'claude-model',
      thinking: 'low',
    });
    expect(incompatible).toThrow(InvalidAgentModelError);
  });

  test.each([
    'gpt-5.6-luna',
    'deepseek-v4-flash-0731',
  ])('resolves explicit managed model %s without an explicit provider', (model) => {
    const resolved = resolveAgentConfig(
      {harness: 'pi', model, thinking: 'max'},
      {
        workspaceDefaultProviderId: 'anthropic',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'shipfox',
      model,
      thinking: 'max',
    });
  });

  test('prefers the managed provider when the workspace default serves the same model id', () => {
    const resolved = resolveAgentConfig(
      {harness: 'pi', model: 'claude-opus-5'},
      {
        workspaceDefaultProviderId: 'anthropic',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved.provider).toBe('shipfox');
    expect(resolved.model).toBe('claude-opus-5');
  });

  test('ignores the workspace default provider when a managed provider exists', () => {
    const resolved = resolveAgentConfig(
      {},
      {
        workspaceDefaultProviderId: 'openai',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved.provider).toBe('shipfox');
    expect(resolved.model).toBe('responses-model');
  });

  test('keeps the instance default provider when a managed provider exists', () => {
    const resolved = resolveAgentConfig(
      {},
      {
        workspaceDefaultProviderId: 'anthropic',
        instanceDefaultProvider: 'openai',
        instanceDefaultModel: 'gpt-5.5-pro',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-5.5-pro');
  });

  test('falls back by harness without restoring the workspace default provider', () => {
    const resolved = resolveAgentConfig(
      {harness: 'claude'},
      {
        workspaceDefaultProviderId: 'openai',
        managedProvider: {
          ...managedProvider(),
          models: [
            {
              id: 'responses-model',
              label: 'Responses model',
              api: 'openai-responses' as const,
            },
          ],
        },
      },
    );

    expect(resolved.provider).toBe('anthropic');
    expect(resolved.model).toBe('claude-opus-5');
  });

  test('does not infer a workspace provider from an explicit workspace-only model', () => {
    const resolve = () =>
      resolveAgentConfig(
        {model: 'gpt-5.5-pro'},
        {
          workspaceDefaultProviderId: 'openai',
          managedProvider: managedProvider(),
        },
      );

    expect(resolve).toThrow(InvalidAgentModelError);
  });

  test('keeps an explicit workspace provider when a managed provider exists', () => {
    const resolved = resolveAgentConfig(
      {provider: 'openai', model: 'gpt-5.5-pro'},
      {
        workspaceDefaultProviderId: 'anthropic',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved.provider).toBe('openai');
    expect(resolved.model).toBe('gpt-5.5-pro');
  });

  test('instance model and thinking overrides win over managed provider defaults', () => {
    const resolved = resolveAgentConfig(
      {provider: 'shipfox'},
      {
        managedProvider: managedProvider(),
        instanceDefaultProvider: 'shipfox',
        instanceDefaultModel: 'claude-model',
        instanceDefaultThinking: 'high',
      },
    );

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'shipfox',
      model: 'claude-model',
      thinking: 'high',
    });
  });

  test('defaults to the managed provider when workspace providers are disabled', () => {
    const resolved = resolveAgentConfig(
      {},
      {
        workspaceProviders: 'disabled',
        workspaceDefaultProviderId: 'openai',
        instanceDefaultProvider: 'openai',
        managedProvider: managedProvider(),
      },
    );

    expect(resolved.provider).toBe('shipfox');
    expect(resolved.model).toBe('responses-model');
  });

  test('rejects foreign provider references when workspace providers are disabled', () => {
    const resolve = () =>
      resolveAgentConfig(
        {provider: 'openai'},
        {workspaceProviders: 'disabled', managedProvider: managedProvider()},
      );

    expect(resolve).toThrow(WorkspaceProvidersDisabledError);
    expect(resolve).toThrow('This instance only supports provider `shipfox`');
  });

  test('uses instance model and thinking only for the resolved instance model provider', () => {
    const resolved = resolveAgentConfig(
      {provider: 'openai'},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultModel: 'claude-opus-4-8',
        instanceDefaultThinking: 'low',
      },
    );

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      thinking: 'xhigh',
    });
  });

  test('resolves harness from explicit step, then default', () => {
    const explicit = resolveAgentConfig({harness: 'claude'});
    const workspace = resolveAgentConfig({}, {workspaceDefaultHarnessId: 'claude'});
    const fallback = resolveAgentConfig({});

    expect(explicit.harness).toBe('claude');
    expect(workspace.harness).toBe('claude');
    expect(fallback.harness).toBe('pi');
  });

  test('resolves thinking from explicit step, workspace, instance match, then default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', thinking: 'low'},
      {workspaceProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {instanceDefaultProvider: 'anthropic', instanceDefaultThinking: 'medium'},
    );
    const fallback = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.thinking).toBe('low');
    expect(workspace.thinking).toBe('medium');
    expect(instance.thinking).toBe('medium');
    expect(fallback.thinking).toBe('xhigh');
  });

  test('throws for unsupported providers and unavailable models', () => {
    expect(() => resolveAgentConfig({provider: 'amazon-bedrock'})).toThrow(
      UnsupportedModelProviderError,
    );
    expect(() => resolveAgentConfig({provider: 'anthropic', model: 'not-a-model'})).toThrow(
      InvalidAgentModelError,
    );
  });

  test('rejects explicit provider values incompatible with the harness', () => {
    const resolve = () => resolveAgentConfig({harness: 'claude', provider: 'openai'});

    expect(resolve).toThrow(UnsupportedHarnessProviderError);
  });

  test('skips incompatible default providers for the selected harness', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
    ]);

    const resolved = resolveAgentConfig(
      {harness: 'claude'},
      {
        workspaceDefaultProviderId: 'openai',
        workspaceProviderConfigs,
        instanceDefaultProvider: 'deepseek',
      },
    );

    expect(resolved.provider).toBe('anthropic');
  });

  test('keeps custom providers pi-only', () => {
    const workspaceProviderConfigs = new Map([
      [
        'local-vllm',
        {
          kind: 'custom' as const,
          defaultModel: null,
          defaultThinking: 'medium' as const,
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        },
      ],
    ]);

    const pi = resolveAgentConfig({provider: 'local-vllm'}, {workspaceProviderConfigs});
    const claude = () =>
      resolveAgentConfig({harness: 'claude', provider: 'local-vllm'}, {workspaceProviderConfigs});

    expect(pi.provider).toBe('local-vllm');
    expect(claude).toThrow(UnsupportedHarnessProviderError);
  });

  test('rejects explicit models outside the harness catalog', () => {
    const resolve = () =>
      resolveAgentConfig({harness: 'claude', provider: 'anthropic', model: 'gpt-5.5-pro'});

    expect(resolve).toThrow(InvalidAgentModelError);
  });

  test('skips default models outside the harness catalog', () => {
    const resolved = resolveAgentConfig(
      {harness: 'claude', provider: 'anthropic'},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultModel: 'not-a-model',
      },
    );

    expect(resolved.model).toBe('claude-opus-5');
  });

  test('does not evaluate catalog model fallback before a valid workspace default model', () => {
    vi.spyOn(harnessCatalog, 'listHarnessProviderModels').mockImplementation(
      (harness, provider) => {
        if (new Error('capture catalog lookup stack').stack?.includes('catalogDefaultModel')) {
          throw new InvalidAgentModelError(harness, provider, '');
        }
        return [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}];
      },
    );
    const workspaceProviderConfigs = new Map([
      ['anthropic' as const, {defaultModel: 'claude-opus-4-8', defaultThinking: 'medium' as const}],
    ]);

    const resolved = resolveAgentConfig({provider: 'anthropic'}, {workspaceProviderConfigs});

    expect(resolved.model).toBe('claude-opus-4-8');
  });

  test('validates thinking against the selected harness', () => {
    const claudeOff = () => resolveAgentConfig({harness: 'claude', thinking: 'off'});
    const piMax = resolveAgentConfig({harness: 'pi', thinking: 'max'});

    expect(claudeOff).toThrow(UnsupportedHarnessThinkingError);
    expect(piMax.thinking).toBe('max');
  });

  test('ignores stale provider thinking defaults outside the selected harness', () => {
    const workspaceProviderConfigs = new Map([
      ['anthropic' as const, {defaultModel: 'claude-opus-4-8', defaultThinking: 'off' as const}],
    ]);

    const resolved = resolveAgentConfig(
      {harness: 'claude', provider: 'anthropic'},
      {workspaceProviderConfigs},
    );

    expect(resolved.thinking).toBe('xhigh');
  });

  test('falls through to the instance default when the workspace default model provider is null', () => {
    const resolved = resolveAgentConfig(
      {},
      {workspaceDefaultProviderId: null, instanceDefaultProvider: 'anthropic'},
    );

    expect(resolved.provider).toBe('anthropic');
  });

  test('skips a stored workspace default model provider that is no longer supported', () => {
    const resolved = resolveAgentConfig(
      {},
      {workspaceDefaultProviderId: 'amazon-bedrock' as SupportedModelProviderId},
    );

    expect(resolved.provider).toBe('anthropic');
  });

  test('skips an unknown instance default model', () => {
    const resolved = resolveAgentConfig(
      {},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultModel: 'not-a-model',
      },
    );

    expect(resolved.model).toBe('claude-opus-5');
  });

  test('catalogDefaultAgentResolver uses catalog-only defaults', () => {
    const resolved = catalogDefaultAgentResolver({provider: 'openai'});

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      thinking: 'xhigh',
    });
  });
});

describe('createWorkspaceAgentDefaultsResolver', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  test('preloads workspace settings and model provider configs for resolution', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );
    await setDefaultModelProvider({workspaceId, providerId: 'openai'});
    await setDefaultHarness({workspaceId, harnessId: 'claude'});

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({});
    const settings = await getAgentWorkspaceSettings(workspaceId);

    expect(settings?.defaultProviderId).toBe('openai');
    expect(settings?.defaultHarnessId).toBe('claude');
    expect(resolved).toEqual({
      harness: 'claude',
      provider: 'anthropic',
      model: 'claude-opus-5',
      thinking: 'xhigh',
    });
  });

  test('falls back to catalog defaults when no workspace settings exist', async () => {
    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);

    const resolved = resolver({});

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-5',
      thinking: 'xhigh',
    });
  });

  test('uses workspace model provider config defaults when settings row does not exist', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({provider: 'openai'});

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });
  });

  test('uses catalog model when the workspace model provider config keeps latest selected', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        defaultModel: null,
        defaultThinking: 'medium',
      }),
    );

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({provider: 'openai'});

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'openai',
      model: 'gpt-5.6-sol',
      thinking: 'medium',
    });
  });

  test('uses custom workspace defaults without filtering the provider config', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: [],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: null,
      defaultThinking: 'low',
    });
    await setDefaultModelProvider({workspaceId, providerId: 'local-vllm'});

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({});

    expect(resolved).toEqual({
      harness: 'pi',
      provider: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'low',
    });
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: params.defaultModel,
    defaultThinking: params.defaultThinking,
  };
}

function managedProvider() {
  return {
    id: 'shipfox',
    label: 'Shipfox',
    models: [
      {id: 'claude-model', label: 'Claude model', api: 'anthropic-messages' as const},
      {id: 'responses-model', label: 'Responses model', api: 'openai-responses' as const},
      {id: 'completion-model', label: 'Completions model', api: 'openai-completions' as const},
      {id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', api: 'openai-responses' as const},
      {
        id: 'deepseek-v4-flash-0731',
        label: 'DeepSeek V4 Flash (0731)',
        api: 'openai-responses' as const,
      },
      {id: 'claude-opus-5', label: 'Claude Opus 5', api: 'anthropic-messages' as const},
    ],
    defaultModel: 'responses-model',
    defaultThinking: 'low' as const,
    resolveCredentials: async () => ({
      api: 'anthropic-messages' as const,
      baseUrl: 'https://gateway.example.com',
      credentials: {api_key: 'token'},
    }),
  };
}
