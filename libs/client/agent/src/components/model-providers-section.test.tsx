import type {CustomModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {
  AGENT_TEST_WORKSPACE_ID,
  managedModelProviderEntry,
  modelProviderCatalogResponse,
  modelProviderConfig,
  modelProviderConfigsResponse,
  modelProviderEntry,
  testModelProviderEntries,
  unsupportedModelProviderEntry,
} from '#test/fixtures/model-providers.js';
import {WorkspaceModelProvidersSection} from './model-providers-section.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function renderModelProviders(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

function requestPath(input: RequestInfo | URL): string {
  return new URL((input as Request).url).pathname;
}

async function openProviderActions(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', {name: `Open ${label} provider actions`}));
}

function customProviderConfig(): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: 'local-vllm',
    display_name: 'Local vLLM',
    api: 'openai-completions',
    base_url: 'http://localhost:8000/v1',
    headers: [{name: 'x-region', value: 'us'}],
    secret_header_names: ['authorization'],
    models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
    default_model: 'llama-3.1',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };
}

describe('WorkspaceModelProvidersSection', () => {
  test('renders managed provider models without exposing workspace provider setup', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([managedModelProviderEntry()], 'disabled', {
              managedProviderId: 'shipfox',
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('Managed provider')).toBeVisible();
    expect(screen.getByText('Shipfox Managed')).toBeVisible();
    expect(screen.getByRole('list', {name: 'Shipfox Managed models'})).toHaveTextContent(
      'Claude Opus 4.8',
    );
    expect(screen.getByRole('list', {name: 'Shipfox Managed models'})).toHaveTextContent(
      'GPT-5.5 Pro',
    );
    expect(screen.queryByText('Available providers')).not.toBeInTheDocument();
    expect(screen.queryByText('Unsupported providers')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Configure custom provider'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Use in a workflow'}));

    const usageDialog = await screen.findByRole('dialog', {
      name: 'Use Shipfox Managed in a workflow',
    });
    expect(usageDialog).toHaveTextContent('provider: shipfox');
    expect(usageDialog).toHaveTextContent('model: claude-opus-4-8');
  });

  test('renders configured, available, and unsupported providers', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry(),
              modelProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
              unsupportedModelProviderEntry(),
            ]),
          ),
        );
      }
      return Promise.resolve(jsonResponse(modelProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('Configured providers')).toBeVisible();
    expect(await screen.findByText('Anthropic')).toBeVisible();
    expect(screen.getByText('Default provider')).toHaveClass('sr-only');
    expect(screen.getByText('Available providers')).toBeVisible();
    expect(
      screen.queryByText('Providers that can be configured for agent steps in this workspace.'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('OpenAI')).toBeVisible();
    const customProviderButton = screen.getByRole('button', {name: 'Configure custom provider'});
    expect(within(customProviderButton).getByText('Custom')).toBeVisible();
    expect(within(customProviderButton).getByText('Configure')).toBeVisible();
    expect(screen.getByText('Unsupported providers')).toBeVisible();
    expect(screen.getByText('Amazon Bedrock')).toBeVisible();
    expect(screen.getByText('AWS cloud credentials are not supported yet.')).toBeVisible();
  });

  test('renders custom configured providers and preserves built-in model actions', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse()));
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: [modelProviderConfig(), customProviderConfig()],
            default_provider_id: 'local-vllm',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    const customProviderRow = (await screen.findByText('Local vLLM')).closest('li');
    if (customProviderRow === null) {
      throw new Error('Expected custom provider row to render');
    }
    expect(within(customProviderRow).queryByText('Custom')).not.toBeInTheDocument();
    expect(screen.queryByText('localhost:8000')).not.toBeInTheDocument();
    expect(screen.queryByText('OpenAI Chat Completions')).not.toBeInTheDocument();
    expect(screen.queryByText('1 secret header')).not.toBeInTheDocument();

    await openProviderActions(user, 'Anthropic');
    expect(screen.getByRole('menuitem', {name: 'Change default model'})).toBeVisible();
  });

  test('filters available providers and clears back to the full available list', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(modelProviderCatalogResponse(testModelProviderEntries(9))),
        );
      }
      return Promise.resolve(
        jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    const search = await screen.findByRole('searchbox', {name: 'Search providers'});

    await user.type(search, 'provider 7');

    expect(screen.getByRole('button', {name: 'Configure Provider 7'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure Provider 1'})).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.getByText('No providers match "missing"')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Clear search'}));

    expect(screen.getByRole('button', {name: 'Configure Provider 1'})).toBeVisible();
    await waitFor(() => expect(search).toHaveFocus());
  });

  test('hides available provider search when the unfiltered list is small', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(modelProviderCatalogResponse(testModelProviderEntries(8))),
        );
      }
      return Promise.resolve(
        jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByRole('button', {name: 'Configure Provider 0'})).toBeVisible();
    expect(screen.queryByRole('searchbox', {name: 'Search providers'})).not.toBeInTheDocument();
  });

  test('waits for configured providers before rendering available provider cards', async () => {
    let resolveConfigs!: (response: Response) => void;
    const configsResponse = new Promise<Response>((resolve) => {
      resolveConfigs = resolve;
    });
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
            ]),
          ),
        );
      }
      return configsResponse;
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByRole('status', {name: 'Loading available providers'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure OpenAI'})).not.toBeInTheDocument();

    resolveConfigs(
      jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null})),
    );

    expect(await screen.findByRole('button', {name: 'Configure OpenAI'})).toBeVisible();
  });

  test('configures a provider, opens the usage modal, and moves focus back on close', async () => {
    const user = userEvent.setup();
    let isConfigured = false;
    let requestBody: unknown;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [
                  {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'},
                  {id: 'gpt-5-mini', label: 'GPT-5 Mini'},
                ],
              }),
            ]),
          ),
        );
      }
      if (request.method === 'PUT') {
        isConfigured = true;
        void request
          .clone()
          .json()
          .then((body) => {
            requestBody = body;
          });
        return Promise.resolve(
          jsonResponse(
            modelProviderConfig({
              provider_id: 'openai',
              default_model: 'gpt-5-mini',
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: isConfigured
              ? [
                  modelProviderConfig({
                    provider_id: 'openai',
                    default_model: 'gpt-5-mini',
                  }),
                ]
              : [],
            default_provider_id: null,
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('No providers configured')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Configure OpenAI'}));
    expect(await screen.findByLabelText('Default model')).toHaveValue('__latest__');
    expect(screen.getByRole('option', {name: 'Latest'})).toBeVisible();
    expect(
      screen.getByText(
        'Latest follows the provider catalog default. Currently resolves to GPT-5.5 Pro.',
      ),
    ).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Default model'), 'gpt-5-mini');
    expect(
      screen.queryByText(
        'Latest follows the provider catalog default. Currently resolves to GPT-5.5 Pro.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText('gpt-5-mini')).toBeVisible();
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    const usageDialog = await screen.findByRole('dialog', {name: 'Use OpenAI in a workflow'});
    expect(within(usageDialog).getByText('model: gpt-5-mini')).toBeVisible();
    await waitFor(() =>
      expect(requestBody).toEqual({
        default_model: 'gpt-5-mini',
        credentials: {api_key: 'sk-proj-secret'},
      }),
    );
    await user.click(within(usageDialog).getByRole('button', {name: 'Done'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('region', {name: 'Configured providers'}),
      ),
    );
    expect(await screen.findByText('OpenAI')).toBeVisible();
    expect(screen.queryByText('GPT-5 Mini')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('sk-proj-secret')).not.toBeInTheDocument();
  }, 10_000);

  test('does not automatically open the usage modal after configuring an additional provider', async () => {
    const user = userEvent.setup();
    let isOpenAiConfigured = false;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry(),
              modelProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
            ]),
          ),
        );
      }
      if (request.method === 'PUT') {
        isOpenAiConfigured = true;
        return Promise.resolve(
          jsonResponse(
            modelProviderConfig({
              provider_id: 'openai',
              default_model: 'gpt-5.5-pro',
            }),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: [
              modelProviderConfig(),
              ...(isOpenAiConfigured
                ? [
                    modelProviderConfig({
                      provider_id: 'openai',
                      default_model: 'gpt-5.5-pro',
                    }),
                  ]
                : []),
            ],
            default_provider_id: 'anthropic',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Configure OpenAI'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      screen.queryByRole('dialog', {name: 'Use OpenAI in a workflow'}),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('OpenAI')).toBeVisible();
  });

  test('submits null default model when configuring a provider with Latest selected', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(
          modelProviderCatalogResponse([
            modelProviderEntry({
              id: 'openai',
              label: 'OpenAI',
              default_model: 'gpt-5.5-pro',
              models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
            }),
          ]),
        );
      }
      if (request.method === 'PUT') {
        requestBody = await request.clone().json();
        return jsonResponse(
          modelProviderConfig({
            provider_id: 'openai',
            default_model: null,
          }),
        );
      }
      return jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    await user.click(await screen.findByRole('button', {name: 'Configure OpenAI'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() =>
      expect(requestBody).toEqual({
        default_model: null,
        credentials: {api_key: 'sk-proj-secret'},
      }),
    );
  });

  test('shows current fingerprints without echoing secret values while editing', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse()));
      }
      return Promise.resolve(jsonResponse(modelProviderConfigsResponse()));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Edit credentials'}));

    await waitFor(() =>
      expect(screen.getAllByText('Edit credentials for Anthropic').length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText('Default model')).not.toBeInTheDocument();
    expect(screen.getByLabelText('API key')).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-ant-secret')).not.toBeInTheDocument();
  });

  test('edits credentials without submitting default model fields', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(
          modelProviderCatalogResponse([
            modelProviderEntry({
              default_model: 'claude-opus-4-8',
              models: [
                {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
                {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
              ],
            }),
          ]),
        );
      }
      if (
        requestPath(input).endsWith('/agent/model-providers/anthropic') &&
        request.method === 'PUT'
      ) {
        requestBody = await request.clone().json();
        return jsonResponse(modelProviderConfig({default_model: 'claude-haiku-4-5'}));
      }
      return jsonResponse(
        modelProviderConfigsResponse({
          configs: [modelProviderConfig({default_model: 'claude-haiku-4-5'})],
          default_provider_id: 'anthropic',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Edit credentials'}));
    await waitFor(() =>
      expect(screen.getAllByText('Edit credentials for Anthropic').length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText('Default model')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('API key'), 'sk-ant-rotated');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      screen.queryByRole('dialog', {name: 'Use Anthropic in a workflow'}),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(requestBody).toEqual({credentials: {api_key: 'sk-ant-rotated'}}));
  });

  test('opens the usage modal from a configured provider action', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry({
                default_model: 'claude-opus-4-8',
                models: [
                  {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
                  {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
                ],
              }),
            ]),
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: [modelProviderConfig({default_model: 'claude-haiku-4-5'})],
            default_provider_id: 'anthropic',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'View workflow example'}));

    const usageDialog = await screen.findByRole('dialog', {name: 'Use Anthropic in a workflow'});
    expect(usageDialog).toHaveTextContent('model: claude-haiku-4-5');
  });

  test('surfaces provider validation errors without clearing the form', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse()));
      }
      if (request.method === 'PUT') {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'provider-validation-failed',
              message: 'Provider validation failed',
              details: {
                provider_id: 'anthropic',
                message: 'Provider rejected the key.',
              },
            },
            {status: 422},
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(modelProviderConfigsResponse({configs: [], default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    await screen.findByText('No providers configured');
    await user.click(screen.getByRole('button', {name: 'Configure Anthropic'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-ant-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    expect(await screen.findByText('Could not save provider')).toBeVisible();
    expect(screen.getByText('Provider rejected the key.')).toBeVisible();
    expect(screen.getByLabelText('API key')).toHaveValue('sk-ant-secret');
  });

  test('sets a configured provider as the default', async () => {
    const user = userEvent.setup();
    let defaultProviderId: 'anthropic' | 'openai' = 'openai';
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(
          modelProviderCatalogResponse([
            modelProviderEntry(),
            modelProviderEntry({
              id: 'openai',
              label: 'OpenAI',
              default_model: 'gpt-5.5-pro',
              models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
            }),
          ]),
        );
      }
      if (requestPath(input).endsWith('/agent/default-model-provider')) {
        requestBody = await request.clone().json();
        defaultProviderId = 'anthropic';
        return jsonResponse({default_provider_id: 'anthropic'});
      }
      return jsonResponse(
        modelProviderConfigsResponse({
          configs: [
            modelProviderConfig(),
            modelProviderConfig({
              provider_id: 'openai',
            }),
          ],
          default_provider_id: defaultProviderId,
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    await waitFor(() => expect(requestBody).toEqual({provider_id: 'anthropic'}));
  });

  test('changes a configured provider default model without credentials', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(
          modelProviderCatalogResponse([
            modelProviderEntry({
              default_model: 'claude-opus-4-8',
              models: [
                {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
                {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
              ],
            }),
          ]),
        );
      }
      if (requestPath(input).endsWith('/agent/model-providers/anthropic/default-model')) {
        requestBody = await request.clone().json();
        return jsonResponse(modelProviderConfig({default_model: null}));
      }
      return jsonResponse(
        modelProviderConfigsResponse({
          configs: [modelProviderConfig({default_model: 'claude-haiku-4-5'})],
          default_provider_id: 'anthropic',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Change default model'}));
    expect(await screen.findByLabelText('Default model')).toHaveValue('claude-haiku-4-5');
    await user.selectOptions(screen.getByLabelText('Default model'), '__latest__');
    expect(
      screen.getByText(
        'Latest follows the provider catalog default. Currently resolves to Claude Opus 4.8.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Save model'}));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(requestBody).toEqual({default_model: null}));
  });

  test('shows a recoverable set-default error', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(
          jsonResponse(
            modelProviderCatalogResponse([
              modelProviderEntry(),
              modelProviderEntry({
                id: 'openai',
                label: 'OpenAI',
                default_model: 'gpt-5.5-pro',
                models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
              }),
            ]),
          ),
        );
      }
      if (requestPath(input).endsWith('/agent/default-model-provider')) {
        return Promise.resolve(
          jsonResponse(
            {code: 'provider-not-configured', message: 'Provider is not configured'},
            {status: 422},
          ),
        );
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: [
              modelProviderConfig(),
              modelProviderConfig({
                provider_id: 'openai',
              }),
            ],
            default_provider_id: 'openai',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Set as default'}));

    expect(
      await screen.findByText('Configure this provider before setting it as the default.'),
    ).toBeVisible();
  });

  test('deletes a configured provider after confirmation', async () => {
    const user = userEvent.setup();
    let isDeleted = false;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse()));
      }
      if (request.method === 'DELETE') {
        isDeleted = true;
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: isDeleted ? [] : [modelProviderConfig()],
            default_provider_id: isDeleted ? null : 'anthropic',
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('Anthropic')).toBeVisible();
    await openProviderActions(user, 'Anthropic');
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    await user.click(screen.getByRole('button', {name: 'Delete'}));

    expect(await screen.findByText('No providers configured')).toBeVisible();
  });

  test('deletes a configured provider that is missing from the catalog', async () => {
    const user = userEvent.setup();
    let isDeleted = false;
    let deletedPath: string | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse([])));
      }
      if (request.method === 'DELETE') {
        isDeleted = true;
        deletedPath = requestPath(input);
        return Promise.resolve(new Response(null, {status: 204}));
      }
      return Promise.resolve(
        jsonResponse(
          modelProviderConfigsResponse({
            configs: isDeleted
              ? []
              : [
                  modelProviderConfig({
                    provider_id: 'local-vllm',
                  }),
                ],
            default_provider_id: null,
          }),
        ),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);
    expect(await screen.findByText('local-vllm')).toBeVisible();
    await openProviderActions(user, 'local-vllm');
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    await user.click(screen.getByRole('button', {name: 'Delete'}));

    await waitFor(() =>
      expect(deletedPath).toBe(
        `/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/local-vllm`,
      ),
    );
    expect(await screen.findByText('No providers configured')).toBeVisible();
  });

  test('disables catalog-backed actions when a configured provider is missing from the catalog', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      if (requestPath(input).endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse([])));
      }
      return Promise.resolve(
        jsonResponse(modelProviderConfigsResponse({default_provider_id: null})),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderModelProviders(<WorkspaceModelProvidersSection workspaceId={AGENT_TEST_WORKSPACE_ID} />);

    expect(await screen.findByText('anthropic')).toBeVisible();
    await openProviderActions(user, 'anthropic');
    expect(screen.getByRole('menuitem', {name: 'Set as default'})).toHaveAttribute('data-disabled');
    expect(screen.getByRole('menuitem', {name: 'Change default model'})).toHaveAttribute(
      'data-disabled',
    );
    expect(screen.getByRole('menuitem', {name: 'View workflow example'})).toHaveAttribute(
      'data-disabled',
    );
    expect(screen.getByRole('menuitem', {name: 'Edit credentials'})).toHaveAttribute(
      'data-disabled',
    );
    expect(screen.getByRole('menuitem', {name: 'Delete'})).not.toHaveAttribute('data-disabled');
  });
});
