import crypto from 'node:crypto';
import * as modelProviderDb from '#db/index.js';
import {getModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {getSecretsByNamespace, setSecrets} from '#test/fixtures/secrets-client.js';
import {agentSystemNamespace} from './credential-fingerprints.js';
import {
  createCustomModelProviderConfig,
  resolveCustomModelProviderDiscoveryParams,
  updateCustomModelProviderConfig,
} from './custom-model-provider-config-service.js';
import {
  CustomModelProviderSlugCollisionError,
  CustomModelProviderStoredSecretBaseUrlChangeError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  InvalidCustomModelProviderHeaderKeepError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
} from './errors.js';
import {
  deleteModelProviderConfig,
  testAndSaveModelProviderConfig,
  updateModelProviderConfigDefaultModel,
} from './model-provider-config-service.js';

describe('testAndSaveModelProviderConfig', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates, stores secrets, and stores a provider config', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials,
        editedBy: '11111111-1111-4111-8111-111111111111',
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });

    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(secrets).toEqual({API_KEY: credentials.api_key});
    expect(stored?.defaultModel).toBeNull();
    expect(stored?.defaultThinking).toBe('xhigh');
  });

  it('validates and stores an explicit provider default model', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'claude-haiku-4-5',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('passes the abort signal to the provider probe', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const abortController = new AbortController();
    const probe = vi.fn().mockResolvedValue(undefined);

    await testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials, signal: abortController.signal},
      {probe},
    );

    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      credentials,
      signal: abortController.signal,
    });
  });

  it('rethrows aborted probe errors without treating them as validation failures', async () => {
    const abortController = new AbortController();
    const error = new Error('Provider probe aborted');
    const probe = vi.fn().mockRejectedValue(error);
    abortController.abort();

    const save = testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials: {api_key: 'sk-ant-secret-abcd'},
        signal: abortController.signal,
      },
      {probe},
    );

    await expect(save).rejects.toBe(error);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('preserves an existing default model when rotating credentials without a model selection', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('stores Latest when rotating credentials with a null default model selection', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: null,
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBeNull();
  });

  it('does not persist when provider validation fails and sanitizes the surfaced error', async () => {
    const secret = 'sk-ant-secret-abcd';
    const base64Secret = Buffer.from(secret, 'utf8').toString('base64');
    const probe = vi
      .fn()
      .mockRejectedValue(new Error(`Provider rejected ${secret} and ${base64Secret}`));

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: secret}},
      {probe},
    );

    await expect(save).rejects.toThrow(ModelProviderValidationError);
    await expect(save).rejects.not.toThrow(secret);
    await expect(save).rejects.not.toThrow(base64Secret);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('sanitizes non-Error probe failures and persists nothing', async () => {
    const probe = vi.fn().mockRejectedValue('raw thrown value');

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow('Provider validation failed.');
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('leaves an existing row unchanged when credential rotation validation fails', async () => {
    const existing = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-opus-4-8',
      defaultThinking: 'high',
    });
    const probe = vi.fn().mockRejectedValue(new Error('bad key'));

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-new-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(ModelProviderValidationError);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toEqual(existing);
  });

  it('propagates InvalidAgentModelError and persists nothing', async () => {
    const error = new InvalidAgentModelError('pi', 'anthropic', 'claude-opus-4-8');
    const probe = vi.fn().mockRejectedValue(error);

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toBe(error);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('rejects an explicit default model outside the model provider catalog', async () => {
    const probe = vi.fn();

    const save = testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'missing-model',
        credentials: {api_key: 'sk-ant-secret-abcd'},
      },
      {probe},
    );

    await expect(save).rejects.toThrow(InvalidAgentModelError);
    expect(probe).not.toHaveBeenCalled();
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('updates the default model without changing credentials', async () => {
    const existing = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
      defaultThinking: 'high',
    });

    const updated = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    expect(updated).toMatchObject({
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: existing.defaultThinking,
    });
  });

  it('stores null when the default model is set to Latest', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });

    const updated = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    expect(updated.defaultModel).toBeNull();
  });

  it('rejects a default model update for a missing config', async () => {
    const update = updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    await expect(update).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('rejects a default model update outside the model provider catalog', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
      defaultThinking: 'high',
    });

    const update = updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'missing-model',
    });

    await expect(update).rejects.toThrow(InvalidAgentModelError);
  });

  it('validates and stores Azure provider configs with multi-field credentials', async () => {
    const probe = vi.fn();
    const credentials = {
      endpoint: 'https://azure.example.test/openai/v1',
      api_key: 'sk-azure-secret-abcd',
    };

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'azure-openai-responses',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({
      workspaceId,
      providerId: 'azure-openai-responses',
    });
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('azure-openai-responses'),
    });

    expect(stored).toEqual(config);
    expect(secrets).toEqual({
      ENDPOINT: credentials.endpoint,
      API_KEY: credentials.api_key,
    });
  });

  it('validates and stores Cloudflare provider configs with multi-field credentials', async () => {
    const probe = vi.fn();
    const credentials = {
      api_key: 'cf-secret-abcd',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    };

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'cloudflare-ai-gateway',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({
      workspaceId,
      providerId: 'cloudflare-ai-gateway',
    });
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('cloudflare-ai-gateway'),
    });

    expect(stored).toEqual(config);
    expect(secrets).toEqual({
      API_KEY: credentials.api_key,
      ACCOUNT_ID: credentials.account_id,
      GATEWAY_ID: credentials.gateway_id,
    });
  });

  it('rejects mismatched credential fields and persists nothing', async () => {
    const probe = vi.fn();

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {wrong_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(InvalidCredentialFieldsError);
    expect(probe).not.toHaveBeenCalled();
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('replaces the provider namespace exactly on credential rotation', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'sk-old-secret', STALE_KEY: 'stale-secret'},
    });
    const probe = vi.fn().mockResolvedValue(undefined);

    await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials: {api_key: 'sk-ant-rotated-abcd'},
      },
      {probe},
    );

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });
    expect(secrets).toEqual({API_KEY: 'sk-ant-rotated-abcd'});
  });

  it('keeps a successful save when stale credential pruning fails', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const pruneStaleSecrets = vi.fn().mockRejectedValue(new Error('prune failed'));

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials: {api_key: 'sk-ant-secret-abcd'},
      },
      {probe, pruneStaleSecrets},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });
    expect(stored).toEqual(config);
    expect(secrets).toEqual({API_KEY: 'sk-ant-secret-abcd'});
    expect(pruneStaleSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      expectedKeys: ['API_KEY'],
    });
  });

  it('deletes provider secrets even when the config row is already absent', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'orphaned-secret'},
    });

    const deleted = await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });
    expect(deleted).toBe(false);
    expect(secrets).toEqual({});
  });
});

describe('custom model provider config service', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('creates custom provider configs insert-only and rejects duplicate slugs', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const first = await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({api_key: 'sk-local-original'}),
      },
      {probe},
    );

    const duplicate = createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({api_key: 'sk-local-replacement'}),
      },
      {probe},
    );

    await expect(duplicate).rejects.toThrow(CustomModelProviderSlugCollisionError);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'local-vllm'});
    expect(stored?.id).toBe(first.id);
    expect(stored?.requiresApiKey).toBe(true);
  });

  it('stores custom provider key intent from create bodies', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);

    const keyed = await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({slug: 'keyed-provider', api_key: 'sk-keyed'}),
      },
      {probe},
    );
    const keyless = await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({slug: 'keyless-provider', api_key: undefined}),
      },
      {probe},
    );

    expect(keyed.requiresApiKey).toBe(true);
    expect(keyless.requiresApiKey).toBe(false);
  });

  it('does not let concurrent duplicate custom creates overwrite the winner secrets', async () => {
    let probeCalls = 0;
    let releaseProbes: () => void = () => undefined;
    const bothProbesStarted = new Promise<void>((resolve) => {
      releaseProbes = resolve;
    });
    const probe = vi.fn(async () => {
      probeCalls += 1;
      if (probeCalls === 2) releaseProbes();
      await bothProbesStarted;
    });
    const firstSecret = 'sk-local-original-abcd';
    const secondSecret = 'sk-local-replacement-wxyz';

    const results = await Promise.allSettled([
      createCustomModelProviderConfig(
        {workspaceId, body: createCustomBody({api_key: firstSecret})},
        {probe},
      ),
      createCustomModelProviderConfig(
        {workspaceId, body: createCustomBody({api_key: secondSecret})},
        {probe},
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('local-vllm'),
    });
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(CustomModelProviderSlugCollisionError);
    expect([firstSecret, secondSecret]).toContain(secrets.API_KEY);
  });

  it('updates custom headers as a full replacement and preserves an omitted api key', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [
            {name: 'authorization', value: 'Bearer old', secret: true},
            {name: 'x-region', value: 'us', secret: false},
          ],
        }),
      },
      {probe},
    );

    const updated = await updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {
          headers: [
            {name: 'x-region', value: 'eu', secret: true},
            {name: 'x-plain', value: 'plain', secret: false},
          ],
        },
      },
      {probe},
    );

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('local-vllm'),
    });
    expect(probe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: 'sk-local-original',
        headers: {'x-region': 'eu', 'x-plain': 'plain'},
      }),
    );
    expect(secrets).toEqual({API_KEY: 'sk-local-original', HEADER_782D726567696F6E: 'eu'});
    expect(updated.headers).toEqual([{name: 'x-plain', value: 'plain'}]);
    expect(updated.secretHeaderNames).toEqual(['x-region']);
    expect(updated.requiresApiKey).toBe(true);
  });

  it('marks a keyless custom provider as requiring a key when an api key is added', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({api_key: undefined}),
      },
      {probe},
    );

    const updated = await updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {api_key: 'sk-local-added'},
      },
      {probe},
    );

    expect(updated.requiresApiKey).toBe(true);
  });

  it('rolls back custom provider secrets when config update persistence fails', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [{name: 'authorization', value: 'Bearer old', secret: true}],
        }),
      },
      {probe},
    );
    vi.spyOn(modelProviderDb, 'upsertModelProviderConfig').mockRejectedValueOnce(
      new Error('config write failed'),
    );

    const update = updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {
          api_key: 'sk-local-replacement',
          headers: [{name: 'x-replacement', value: 'new secret', secret: true}],
        },
      },
      {probe},
    );

    await expect(update).rejects.toThrow('config write failed');
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('local-vllm'),
    });
    expect(secrets).toEqual({
      API_KEY: 'sk-local-original',
      HEADER_617574686F72697A6174696F6E: 'Bearer old',
    });
  });

  it('keeps stored secret header values during custom provider updates', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          headers: [
            {name: 'authorization', value: 'Bearer old', secret: true},
            {name: 'x-region', value: 'us', secret: false},
          ],
        }),
      },
      {probe},
    );

    const updated = await updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {
          headers: [
            {name: 'authorization', secret: true, keep: true},
            {name: 'x-region', value: 'eu', secret: false},
          ],
        },
      },
      {probe},
    );

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('local-vllm'),
    });
    expect(probe).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: {authorization: 'Bearer old', 'x-region': 'eu'},
      }),
    );
    expect(secrets).toEqual({
      API_KEY: 'sk-local-original',
      HEADER_617574686F72697A6174696F6E: 'Bearer old',
    });
    expect(updated.headers).toEqual([{name: 'x-region', value: 'eu'}]);
    expect(updated.secretHeaderNames).toEqual(['authorization']);
  });

  it('rejects custom updates that reuse stored secrets after changing the base URL', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [{name: 'authorization', value: 'Bearer old', secret: true}],
        }),
      },
      {probe},
    );

    const update = updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {
          base_url: 'https://attacker.example.com/v1',
          headers: [{name: 'authorization', secret: true, keep: true}],
        },
      },
      {probe},
    );

    await expect(update).rejects.toThrow(CustomModelProviderStoredSecretBaseUrlChangeError);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('allows stored secret reuse when the base URL only changes trailing slashes', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    const provider = await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [{name: 'authorization', value: 'Bearer old', secret: true}],
        }),
      },
      {probe},
    );

    const updated = await updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: provider.providerId,
        body: {
          base_url: 'http://127.0.0.1:11434/v1/',
          headers: [{name: 'authorization', secret: true, keep: true}],
        },
      },
      {probe},
    );

    expect(updated.baseUrl).toBe('http://127.0.0.1:11434/v1/');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('rejects kept secret headers that are renamed or missing', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          headers: [{name: 'authorization', value: 'Bearer old', secret: true}],
        }),
      },
      {probe},
    );

    const update = updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {headers: [{name: 'x-authorization', secret: true, keep: true}]},
      },
      {probe},
    );

    await expect(update).rejects.toThrow(InvalidCustomModelProviderHeaderKeepError);
  });

  it('resolves slug-scoped discovery params from stored custom provider secrets', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [
            {name: 'authorization', value: 'Bearer old', secret: true},
            {name: 'x-region', value: 'us', secret: false},
          ],
        }),
      },
      {probe},
    );

    const discoveryParams = await resolveCustomModelProviderDiscoveryParams({
      workspaceId,
      providerId: 'local-vllm',
      body: {
        headers: [
          {name: 'authorization', secret: true, keep: true},
          {name: 'x-region', value: 'eu', secret: false},
        ],
      },
    });

    expect(discoveryParams).toEqual({
      api: 'openai-responses',
      base_url: 'http://127.0.0.1:11434/v1',
      api_key: 'sk-local-original',
      headers: [
        {name: 'authorization', value: 'Bearer old'},
        {name: 'x-region', value: 'eu'},
      ],
    });
  });

  it('rejects slug-scoped discovery that reuses stored secrets after changing the base URL', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({
          api_key: 'sk-local-original',
          headers: [{name: 'authorization', value: 'Bearer old', secret: true}],
        }),
      },
      {probe},
    );

    const discoveryParams = resolveCustomModelProviderDiscoveryParams({
      workspaceId,
      providerId: 'local-vllm',
      body: {
        base_url: 'https://attacker.example.com/v1',
        headers: [{name: 'authorization', secret: true, keep: true}],
      },
    });

    await expect(discoveryParams).rejects.toThrow(
      CustomModelProviderStoredSecretBaseUrlChangeError,
    );
  });

  it('clears a stored custom default model when replacement models drop it', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({default_model: 'llama-3.1'}),
      },
      {probe},
    );

    const updated = await updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {models: [{id: 'llama-4', label: 'Llama 4'}]},
      },
      {probe},
    );

    expect(updated.defaultModel).toBeNull();
    expect(probe).toHaveBeenLastCalledWith(
      expect.objectContaining({model: {id: 'llama-4', label: 'Llama 4'}}),
    );
  });

  it('rejects an explicit custom default model outside the custom model list', async () => {
    const probe = vi.fn().mockResolvedValue(undefined);
    await createCustomModelProviderConfig(
      {
        workspaceId,
        body: createCustomBody({default_model: 'llama-3.1'}),
      },
      {probe},
    );

    const update = updateCustomModelProviderConfig(
      {
        workspaceId,
        providerId: 'local-vllm',
        body: {default_model: 'missing-model'},
      },
      {probe},
    );

    await expect(update).rejects.toThrow(InvalidAgentModelError);
  });
});

function createCustomBody(
  overrides: Partial<Parameters<typeof createCustomModelProviderConfig>[0]['body']> = {},
): Parameters<typeof createCustomModelProviderConfig>[0]['body'] {
  return {
    slug: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-responses',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: 'sk-local-original',
    headers: [],
    models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
    ...overrides,
  };
}
