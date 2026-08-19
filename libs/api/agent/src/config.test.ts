import type {ManagedModelEntry, ManagedModelProvider} from '@shipfox/api-agent-dto';

describe('agent config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('imports with an API-key-only instance default provider key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'openai');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('openai');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBe('sk-instance-secret');
  });

  it('throws when an instance key is set for a multi-field provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig()).toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('throws when an instance key is set without an instance default provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig()).toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER',
    );
  });

  it('accepts an injected managed provider as the instance default', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'shipfox');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig(managedProvider())).not.toThrow();
  });

  it('rejects an instance API key for an injected managed provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'shipfox');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER_API_KEY', 'sk-instance-secret');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig(managedProvider())).toThrow(
      'AGENT_DEFAULT_PROVIDER_API_KEY cannot be used with a managed model provider',
    );
  });

  it('rejects an instance default that is not a registered provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'not-registered');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig()).toThrow(
      'AGENT_DEFAULT_PROVIDER must name a supported registered provider',
    );
  });

  it.each([
    ['invalid provider ID', managedProvider({id: 'bad_id'}), 'valid provider slug'],
    ['reserved provider ID', managedProvider({id: 'openai'}), 'provider ID is reserved'],
    ['empty provider label', managedProvider({label: ''}), 'label must not be empty'],
    ['empty model list', managedProvider({models: []}), 'at least one model'],
    [
      'empty model ID',
      managedProvider({
        models: [{id: '', label: 'Managed model', api: 'anthropic-messages'}],
      }),
      'models must have IDs and labels',
    ],
    [
      'empty model label',
      managedProvider({
        models: [{id: 'managed-model', label: '', api: 'anthropic-messages'}],
      }),
      'models must have IDs and labels',
    ],
    [
      'duplicate model IDs',
      managedProvider({
        models: [
          {id: 'managed-model', label: 'Managed model', api: 'anthropic-messages'},
          {id: 'managed-model', label: 'Managed model 2', api: 'openai-responses'},
        ],
      }),
      'models must have unique IDs',
    ],
    [
      'invalid model API',
      managedProvider({
        models: [
          {
            id: 'managed-model',
            label: 'Managed model',
            api: 'invalid' as unknown as ManagedModelEntry['api'],
          },
        ],
      }),
      'model API is invalid',
    ],
    [
      'unregistered default model',
      managedProvider({defaultModel: 'missing-model'}),
      'default model is not registered',
    ],
    [
      'invalid default thinking',
      managedProvider({
        defaultThinking: 'invalid' as unknown as ManagedModelProvider['defaultThinking'],
      }),
      'default thinking is invalid',
    ],
    [
      'missing credential resolver',
      managedProvider({
        resolveCredentials: undefined as unknown as ManagedModelProvider['resolveCredentials'],
      }),
      'must resolve credentials',
    ],
  ] as const)('rejects a managed provider with %s', async (_name, provider, message) => {
    vi.resetModules();

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig(provider)).toThrow(message);
  });

  it('imports without an instance key', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'azure-openai-responses');

    const module = await import('./config.js');

    expect(module.config.AGENT_DEFAULT_PROVIDER).toBe('azure-openai-responses');
    expect(module.config.AGENT_DEFAULT_PROVIDER_API_KEY).toBeUndefined();
  });

  it('defaults custom provider egress to local-development friendly settings', async () => {
    vi.resetModules();

    const module = await import('./config.js');

    expect(module.config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS).toBe(true);
    expect(module.config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST).toBe('');
  });

  it('imports custom provider egress cloud overrides', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS', 'false');
    vi.stubEnv('AGENT_CUSTOM_PROVIDER_HOST_DENYLIST', 'metadata.google.internal,10.0.0.0/8');

    const module = await import('./config.js');

    expect(module.config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS).toBe(false);
    expect(module.config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST).toBe(
      'metadata.google.internal,10.0.0.0/8',
    );
  });

  it('defaults pi web access to enabled', async () => {
    vi.resetModules();

    const module = await import('./config.js');

    expect(module.config.AGENT_PI_ENABLED_TOOL_PACKAGES).toBe('pi-web-access');
    expect(module.config.AGENT_PI_WEB_SEARCH_ENABLED).toBe(true);
    expect(module.harnessToolDeploymentConfig).toEqual({
      pi: {enabledToolPackages: ['pi-web-access'], webSearchEnabled: true},
      claude: {enabledToolPackages: []},
    });
  });

  it('allows deployments to disable pi optional tool packages', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_PI_ENABLED_TOOL_PACKAGES', '');

    const module = await import('./config.js');

    expect(module.harnessToolDeploymentConfig).toEqual({
      pi: {enabledToolPackages: [], webSearchEnabled: true},
      claude: {enabledToolPackages: []},
    });
  });

  it('parses enabled pi optional tool packages and web search overrides', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_PI_ENABLED_TOOL_PACKAGES', 'pi-web-access, pi-web-access');
    vi.stubEnv('AGENT_PI_WEB_SEARCH_ENABLED', 'false');

    const module = await import('./config.js');

    expect(module.harnessToolDeploymentConfig).toEqual({
      pi: {enabledToolPackages: ['pi-web-access'], webSearchEnabled: false},
      claude: {enabledToolPackages: []},
    });
  });

  it('throws when pi optional tool packages include an unsupported package', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_PI_ENABLED_TOOL_PACKAGES', 'pi-web-access, unknown-package');

    const importConfig = import('./config.js');

    await expect(importConfig).rejects.toThrow('AGENT_PI_ENABLED_TOOL_PACKAGES');
  });
});

function managedProvider(overrides: Partial<ManagedModelProvider> = {}): ManagedModelProvider {
  return {
    id: 'shipfox',
    label: 'Shipfox',
    models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8', api: 'anthropic-messages' as const}],
    defaultModel: 'claude-opus-4-8',
    defaultThinking: 'high' as const,
    resolveCredentials: async () => ({
      api: 'anthropic-messages' as const,
      baseUrl: 'https://gateway.example.com',
      credentials: {api_key: 'token'},
    }),
    ...overrides,
  };
}
