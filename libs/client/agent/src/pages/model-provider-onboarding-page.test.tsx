import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import {isModelProviderOnboardingDismissed} from '#state/model-provider-onboarding.js';
import {
  AGENT_TEST_WORKSPACE_ID,
  managedModelProviderEntry,
  modelProviderCatalogResponse,
  modelProviderConfig,
  modelProviderEntry,
  testModelProviderEntries,
} from '#test/fixtures/model-providers.js';
import {ModelProviderOnboardingPage} from './model-provider-onboarding-page.js';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function requestPath(input: RequestInfo | URL): string {
  return new URL((input as Request).url).pathname;
}

function renderOnboarding(element: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return render(
    <QueryClientProvider client={queryClient}>
      {element}
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('ModelProviderOnboardingPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('shows managed provider models without asking for workspace credentials', async () => {
    const onConfigured = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(modelProviderCatalogResponse([managedModelProviderEntry()], 'disabled')),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={onConfigured}
      />,
    );

    const heading = await screen.findByRole('heading', {name: 'Managed inference is ready'});
    expect(heading).toBeVisible();
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText('Shipfox Managed')).toBeVisible();
    expect(screen.getByRole('list', {name: 'Shipfox Managed models'})).toHaveTextContent(
      'GPT-5.5 Pro',
    );
    expect(screen.queryByRole('button', {name: 'Choose pi'})).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API key')).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', {name: 'Continue to project setup'}));

    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  test('skips setup, records the dismissed flag, and does not save a provider or harness', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const onConfigured = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={onSkip}
        onConfigured={onConfigured}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Skip for now'}));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfigured).not.toHaveBeenCalled();
    expect(isModelProviderOnboardingDismissed(AGENT_TEST_WORKSPACE_ID)).toBe(true);
    expect(fetchImpl.mock.calls.some(([input]) => (input as Request).method === 'PUT')).toBe(false);
  });

  test('places skip before the harness choices', () => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse())),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={vi.fn()}
      />,
    );

    const skip = screen.getByRole('button', {name: 'Skip for now'});
    const harness = screen.getByRole('button', {name: 'Choose pi'});

    expect(skip.compareDocumentPosition(harness)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test('shows harnesses first, filters providers by harness, and supports going back', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(
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
      ),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', {name: 'Choose agent harness'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Choose pi'})).toBeVisible();
    expect(screen.getByText('Works with 30+ model providers')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Choose Claude'})).toBeVisible();
    expect(screen.getByText('Runs on your Anthropic API key')).toBeVisible();

    await user.click(screen.getByRole('button', {name: 'Choose Claude'}));

    expect(await screen.findByRole('button', {name: 'Configure Anthropic'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure OpenAI'})).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Back'}));
    await user.click(screen.getByRole('button', {name: 'Choose pi'}));

    expect(await screen.findByRole('button', {name: 'Configure Anthropic'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Configure OpenAI'})).toBeVisible();
  });

  test('filters supported providers and clears a no-match search after choosing pi', async () => {
    const user = userEvent.setup();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse(modelProviderCatalogResponse(testModelProviderEntries(9)))),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', {name: 'Choose pi'}));
    const search = await screen.findByRole('searchbox', {name: 'Search providers'});

    await user.type(search, 'provider 6');

    expect(screen.getByRole('button', {name: 'Configure Provider 6'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Configure Provider 1'})).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'missing');
    expect(screen.getByText('No providers match "missing"')).toBeVisible();
    await user.click(screen.getByRole('button', {name: 'Clear search'}));

    expect(screen.getByRole('button', {name: 'Configure Provider 1'})).toBeVisible();
    await waitFor(() => expect(search).toHaveFocus());
  });

  test('skip still continues when localStorage rejects the dismissed write', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      configureApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(modelProviderCatalogResponse())),
      });

      renderOnboarding(
        <ModelProviderOnboardingPage
          workspaceId={AGENT_TEST_WORKSPACE_ID}
          onSkip={onSkip}
          onConfigured={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', {name: 'Skip for now'}));

      expect(onSkip).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
    }
  });

  test('saves a pi provider as default and skips the default harness request', async () => {
    const user = userEvent.setup();
    const onConfigured = vi.fn();
    const requestBodies: unknown[] = [];
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
        requestBodies.push(await request.clone().json());
        return jsonResponse(modelProviderConfig({provider_id: 'openai', default_model: null}));
      }
      return jsonResponse({}, {status: 404});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={onConfigured}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Choose pi'}));
    await user.click(await screen.findByRole('button', {name: 'Configure OpenAI'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-proj-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() =>
      expect(requestBodies).toEqual([
        {
          default_model: null,
          credentials: {api_key: 'sk-proj-secret'},
          set_as_default: true,
        },
      ]),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
    expect(
      fetchImpl.mock.calls.some(([input]) => requestPath(input).endsWith('/agent/default-harness')),
    ).toBe(false);
  });

  test('saves the chosen Claude harness after the provider is persisted', async () => {
    const user = userEvent.setup();
    const onConfigured = vi.fn();
    const requests: Array<{path: string; body: unknown}> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = requestPath(input);
      if (path.endsWith('/agent/model-provider-catalog')) {
        return jsonResponse(modelProviderCatalogResponse());
      }
      if (request.method === 'PUT') {
        const body = await request.clone().json();
        requests.push({path, body});
        if (path.endsWith('/agent/default-harness')) {
          return jsonResponse({default_harness_id: 'claude'});
        }
        return jsonResponse(modelProviderConfig());
      }
      return jsonResponse({}, {status: 404});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={onConfigured}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Choose Claude'}));
    await user.click(await screen.findByRole('button', {name: 'Configure Anthropic'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-ant-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
    expect(requests).toEqual([
      {
        path: `/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/model-providers/anthropic`,
        body: {
          default_model: null,
          credentials: {api_key: 'sk-ant-secret'},
          set_as_default: true,
        },
      },
      {
        path: `/workspaces/${AGENT_TEST_WORKSPACE_ID}/agent/default-harness`,
        body: {harness_id: 'claude'},
      },
    ]);
  });

  test('keeps the user on the page when saving the default harness fails', async () => {
    const user = userEvent.setup();
    const onConfigured = vi.fn();
    let harnessAttempts = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      const path = requestPath(input);
      if (path.endsWith('/agent/model-provider-catalog')) {
        return Promise.resolve(jsonResponse(modelProviderCatalogResponse()));
      }
      if (request.method === 'PUT' && path.endsWith('/agent/default-harness')) {
        harnessAttempts += 1;
        if (harnessAttempts === 1) {
          return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
        }
        return Promise.resolve(jsonResponse({default_harness_id: 'claude'}));
      }
      if (request.method === 'PUT') {
        return Promise.resolve(jsonResponse(modelProviderConfig()));
      }
      return Promise.resolve(jsonResponse({}, {status: 404}));
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={vi.fn()}
        onConfigured={onConfigured}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Choose Claude'}));
    await user.click(await screen.findByRole('button', {name: 'Configure Anthropic'}));
    await user.type(await screen.findByLabelText('API key'), 'sk-ant-secret');
    await user.click(screen.getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(harnessAttempts).toBe(1));
    expect(await screen.findByText('Could not save default harness')).toBeVisible();
    expect(screen.getByRole('dialog', {name: 'Configure Anthropic'})).toBeVisible();
    expect(onConfigured).not.toHaveBeenCalled();

    await user.click(within(screen.getByRole('dialog')).getByRole('button', {name: 'Test & save'}));

    await waitFor(() => expect(onConfigured).toHaveBeenCalledTimes(1));
  });

  test('keeps skip available when the catalog fails to load after selecting a harness', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderOnboarding(
      <ModelProviderOnboardingPage
        workspaceId={AGENT_TEST_WORKSPACE_ID}
        onSkip={onSkip}
        onConfigured={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Choose pi'}));
    expect(await screen.findByText("Couldn't load model provider catalog")).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Skip for now'}));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
