import type {ModelProviderCatalogEntryDto, ModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {screen, userEvent, within} from 'storybook/test';
import {ModelProviderOnboardingPage} from './model-provider-onboarding-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

type Scenario = 'available' | 'loading' | 'catalog-error' | 'no-providers' | 'long-names';

interface ModelProviderOnboardingStoryProps {
  scenario: Scenario;
}

const CATALOG: ModelProviderCatalogEntryDto[] = [
  providerEntry({
    id: 'anthropic',
    label: 'Anthropic',
    default_model: 'claude-opus-4-8',
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
      {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5'},
    ],
  }),
  providerEntry({
    id: 'openai',
    label: 'OpenAI',
    default_model: 'gpt-5.5-pro',
    models: [
      {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'},
      {id: 'gpt-5-mini', label: 'GPT-5 Mini'},
    ],
  }),
  providerEntry({
    id: 'xai',
    label: 'xAI',
    default_model: 'grok-code-fast-1',
    models: [{id: 'grok-code-fast-1', label: 'Grok Code Fast 1'}],
  }),
  providerEntry({
    id: 'openrouter',
    label: 'OpenRouter',
    default_model: 'openrouter/auto',
    models: [{id: 'openrouter/auto', label: 'OpenRouter Auto'}],
  }),
  providerEntry({
    id: 'google',
    label: 'Google Gemini',
    default_model: 'gemini-3-pro',
    models: [{id: 'gemini-3-pro', label: 'Gemini 3 Pro'}],
  }),
  providerEntry({
    id: 'mistral',
    label: 'Mistral AI',
    default_model: 'codestral-latest',
    models: [{id: 'codestral-latest', label: 'Codestral Latest'}],
  }),
  providerEntry({
    id: 'groq',
    label: 'Groq',
    default_model: 'llama-4-fast',
    models: [{id: 'llama-4-fast', label: 'Llama 4 Fast'}],
  }),
  providerEntry({
    id: 'deepseek',
    label: 'DeepSeek',
    default_model: 'deepseek-coder',
    models: [{id: 'deepseek-coder', label: 'DeepSeek Coder'}],
  }),
  providerEntry({
    id: 'moonshotai',
    label: 'Moonshot AI',
    default_model: 'kimi-k2',
    models: [{id: 'kimi-k2', label: 'Kimi K2'}],
  }),
  providerEntry({
    id: 'azure-openai-responses',
    label: 'Azure OpenAI Responses',
    default_model: 'gpt-5.5-pro',
    models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
  }),
  providerEntry({
    id: 'amazon-bedrock',
    label: 'Amazon Bedrock',
    support_status: 'unsupported',
    credential_fields: [],
    unsupported_reason: 'AWS cloud credentials are not supported yet.',
    models: [],
  }),
];

function ModelProviderOnboardingStory({scenario}: ModelProviderOnboardingStoryProps) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="bg-background-subtle-base px-24 py-32">
        <ModelProviderOnboardingPage
          workspaceId={WORKSPACE_ID}
          onSkip={() => undefined}
          onConfigured={() => undefined}
        />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Agent/ProviderOnboarding',
  component: ModelProviderOnboardingStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'available'},
} satisfies Meta<typeof ModelProviderOnboardingStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const CatalogError: Story = {
  args: {scenario: 'catalog-error'},
};

export const NoProvidersAvailable: Story = {
  args: {scenario: 'no-providers'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Choose pi'}));
  },
};

export const LongNames: Story = {
  args: {scenario: 'long-names'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Choose pi'}));
  },
};

export const FilteredProviders: Story = {
  args: {scenario: 'available'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Choose pi'}));
    await userEvent.type(
      await canvas.findByRole('searchbox', {name: 'Search providers'}),
      'openrouter',
    );
    await canvas.findByRole('button', {name: 'Configure OpenRouter'});
  },
};

export const NoMatchingProviders: Story = {
  args: {scenario: 'available'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Choose pi'}));
    await userEvent.type(
      await canvas.findByRole('searchbox', {name: 'Search providers'}),
      'not-a-provider',
    );
    await canvas.findByRole('button', {name: 'Clear search'});
  },
};

export const ConfigureModalOpen: Story = {
  args: {scenario: 'available'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Choose pi'}));
    await userEvent.click(await canvas.findByRole('button', {name: 'Configure Anthropic'}));
    await screen.findByLabelText('API key');
  },
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    const request = input instanceof Request ? input : undefined;
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (url.pathname.endsWith('/agent/model-provider-catalog')) {
      if (scenario === 'catalog-error') return Promise.resolve(errorResponse());
      return Promise.resolve(
        jsonResponse({
          providers: catalogForScenario(scenario),
        }),
      );
    }
    if (request?.method === 'PUT' && url.pathname.includes('/agent/model-providers/')) {
      return Promise.resolve(
        jsonResponse(
          providerConfig({
            provider_id: url.pathname.endsWith('/openai') ? 'openai' : 'anthropic',
          }),
        ),
      );
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function catalogForScenario(scenario: Scenario): ModelProviderCatalogEntryDto[] {
  if (scenario === 'no-providers') return [];
  if (scenario !== 'long-names') return CATALOG;
  return [
    providerEntry({
      id: 'anthropic',
      label: 'Anthropic Enterprise Production Claude Provider With Long Label',
      default_model: 'claude-opus-4-8',
    }),
    providerEntry({
      id: 'openai',
      label: 'OpenAI Platform Shared Workspace Credentials With Long Label',
      default_model: 'gpt-5.5-pro',
      models: [{id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro'}],
    }),
  ];
}

function providerEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    support_status: 'supported',
    default_model: null,
    credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
    unsupported_reason: null,
    models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    ...overrides,
  };
}

function providerConfig(
  overrides: Partial<Omit<ModelProviderConfigDto, 'kind'>> = {},
): ModelProviderConfigDto {
  return {
    kind: 'builtin',
    provider_id: 'anthropic',
    default_model: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function errorResponse() {
  return jsonResponse({code: 'server-error'}, {status: 500, statusText: 'Server error'});
}
