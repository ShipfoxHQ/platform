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

  it('defaults workspace provider configuration to enabled', async () => {
    vi.resetModules();

    const module = await import('./config.js');

    expect(module.config.AGENT_WORKSPACE_PROVIDERS).toBe('enabled');
    expect(module.workspaceProvidersPolicy).toBe('enabled');
  });

  it('accepts disabled workspace provider configuration with a managed provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_WORKSPACE_PROVIDERS', 'disabled');

    const module = await import('./config.js');

    expect(module.workspaceProvidersPolicy).toBe('disabled');
    expect(() => module.assertAgentConfig(managedProvider())).not.toThrow();
  });

  it('requires a managed provider when workspace provider configuration is disabled', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_WORKSPACE_PROVIDERS', 'disabled');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig()).toThrow(
      'AGENT_WORKSPACE_PROVIDERS=disabled requires an injected managed model provider',
    );
  });

  it('rejects a foreign instance default when workspace provider configuration is disabled', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_WORKSPACE_PROVIDERS', 'disabled');
    vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'openai');

    const module = await import('./config.js');

    expect(() => module.assertAgentConfig(managedProvider())).toThrow(
      'This instance only supports provider `shipfox`',
    );
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
    ...(
      [
        ['null context window', {context_window: null}],
        ['zero max output tokens', {max_output_tokens: 0}],
        ['fractional context window', {context_window: 1.5}],
        ['string context window', {context_window: '128000'}],
        ['non-boolean reasoning', {reasoning: 'true'}],
        ['non-boolean input image', {input_image: 1}],
        ['invalid thinking-level map', {thinkingLevelMap: {high: 1}}],
        ['invalid compatibility metadata', {compat: {thinkingFormat: 'unsupported'}}],
      ] as const
    ).map(
      ([name, metadata]) =>
        [
          `invalid ${name}`,
          managedProviderWithModelMetadata(metadata),
          'model metadata is invalid',
        ] as const,
    ),
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

  it('clamps a non-positive close grace to one second', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_CLOSE_GRACE_SECONDS', '0');

    const module = await import('./config.js');

    expect(module.resolveCloseGraceSeconds()).toBe(1);
  });

  it('clamps a non-finite close grace to one second', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_CLOSE_GRACE_SECONDS', 'Infinity');

    const module = await import('./config.js');

    expect(module.resolveCloseGraceSeconds()).toBe(1);
  });

  it('falls back to one second for a fractional close grace instead of flooring it', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_CLOSE_GRACE_SECONDS', '120.5');

    const module = await import('./config.js');

    expect(module.resolveCloseGraceSeconds()).toBe(1);
  });

  it('clamps an oversized close grace to the one-day maximum', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_CLOSE_GRACE_SECONDS', '172800');

    const module = await import('./config.js');

    expect(module.resolveCloseGraceSeconds()).toBe(24 * 60 * 60);
  });

  it('falls back to the default reap batch limit for a zero value', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_REAP_BATCH_LIMIT', '0');

    const module = await import('./config.js');

    expect(module.resolveReapBatchLimit()).toBe(100);
  });

  it('flags a reap threshold at or below the workflows max execution as unsafe', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_REAP_AFTER_SECONDS', '3600');

    const module = await import('./config.js');

    expect(module.isUnsafeReapAfterSeconds()).toBe(true);
  });

  it('flags a reap threshold as unsafe when the deployment raises the max job execution duration', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS', '36000');

    const module = await import('./config.js');

    // Default reap threshold (28800s) is safe against the 6h workflows default
    // but not against a deployment that allows 10h job executions.
    expect(module.isUnsafeReapAfterSeconds()).toBe(true);
  });

  it('treats an invalid max job execution knob as the workflows default', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS', '0');

    const module = await import('./config.js');

    expect(module.resolveMaxJobExecutionSeconds()).toBe(6 * 60 * 60);
  });

  it('treats the default reap threshold as safe', async () => {
    vi.resetModules();

    const module = await import('./config.js');

    expect(module.isUnsafeReapAfterSeconds()).toBe(false);
  });

  it('rejects a malformed session encryption key at import', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_ENCRYPTION_KEK', 'not-base64');

    await expect(import('./config.js')).rejects.toThrow(
      'AGENT_SESSION_ENCRYPTION_KEK must be a canonical base64-encoded 32-byte key',
    );
  });

  it.each([
    ['AGENT_SESSION_RETENTION_DAYS', '0', 'must be a whole number of days >= 1'],
    ['AGENT_SESSION_SEGMENT_GRACE_SECONDS', '1.5', 'must be a whole number of seconds >= 1'],
    ['AGENT_SESSION_BLOB_CAP_BYTES', '0', 'must be a whole number of bytes >= 1'],
  ] as const)('rejects invalid %s at import', async (name, value, message) => {
    vi.resetModules();
    vi.stubEnv(name, value);

    await expect(import('./config.js')).rejects.toThrow(message);
  });

  it('rejects an unsafe session object-storage prefix at import', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_SESSION_STORAGE_S3_PREFIX', 'agent-sessions/../logs');

    await expect(import('./config.js')).rejects.toThrow(
      'Object-storage prefix must be non-empty without leading, trailing, repeated, or parent-directory segments',
    );
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

function managedProviderWithModelMetadata(metadata: object): ManagedModelProvider {
  return managedProvider({
    models: [
      {
        id: 'managed-model',
        label: 'Managed model',
        api: 'anthropic-messages',
        ...metadata,
      } as ManagedModelEntry,
    ],
    defaultModel: 'managed-model',
  });
}
