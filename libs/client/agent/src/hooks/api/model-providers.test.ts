import {configureApiClient} from '@shipfox/client-api';
import {
  AGENT_TEST_WORKSPACE_ID,
  modelProviderCatalogResponse,
  modelProviderConfig,
  modelProviderConfigsResponse,
} from '#test/fixtures/model-providers.js';
import {
  deleteModelProviderConfig,
  getModelProviderCatalog,
  listModelProviderConfigs,
  setDefaultHarness,
  setDefaultModelProvider,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from './model-providers.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('model provider transport', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('fetches the model provider catalog', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse()));
    configureApiClient({fetchImpl});

    const result = await getModelProviderCatalog();

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.providers[0]?.label).toBe('Anthropic');
    expect(request.url).toBe('https://api.example.test/agent/model-provider-catalog');
    expect(request.method).toBe('GET');
  });

  test('preserves the managed-only workspace policy from the catalog', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(modelProviderCatalogResponse(undefined, 'disabled')));
    configureApiClient({fetchImpl});

    const result = await getModelProviderCatalog();

    expect(result.workspaceProviders).toBe('disabled');
  });

  test('fetches workspace model provider configs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderConfigsResponse()));
    configureApiClient({fetchImpl});

    const result = await listModelProviderConfigs({workspaceId: AGENT_TEST_WORKSPACE_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.defaultProviderId).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers`,
    );
    expect(request.method).toBe('GET');
  });

  test('puts model provider credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(modelProviderConfig(), {status: 201});
    });
    configureApiClient({fetchImpl});
    const body = {default_model: 'claude-haiku-4-5', credentials: {api_key: 'sk-ant-secret'}};

    const result = await upsertModelProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      command: {defaultModel: 'claude-haiku-4-5', credentials: {api_key: 'sk-ant-secret'}},
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.providerId).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual(body);
  });

  test('deletes model provider credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    const result = await deleteModelProviderConfig({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toBeUndefined();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic`,
    );
    expect(request.method).toBe('DELETE');
  });

  test('puts a model provider default model without credentials', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(modelProviderConfig({default_model: null}));
    });
    configureApiClient({fetchImpl});
    const defaultModel: string | null = null;

    const result = await updateModelProviderDefaultModel({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId: 'anthropic',
      defaultModel,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.defaultModel).toBeNull();
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic/default-model`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual({default_model: defaultModel});
  });

  test('sets the default model provider', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({default_provider_id: 'anthropic'});
    });
    configureApiClient({fetchImpl});
    const providerId = 'anthropic';

    const result = await setDefaultModelProvider({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      providerId,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.defaultProviderId).toBe('anthropic');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/default-model-provider`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual({provider_id: providerId});
  });

  test('sets the default harness', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({default_harness_id: 'claude'});
    });
    configureApiClient({fetchImpl});
    const harnessId = 'claude' as const;

    const result = await setDefaultHarness({
      workspaceId: AGENT_TEST_WORKSPACE_ID,
      harnessId,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.defaultHarnessId).toBe('claude');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/default-harness`,
    );
    expect(request.method).toBe('PUT');
    expect(requestBody).toEqual({harness_id: harnessId});
  });
});
