import type {
  CustomModelProviderConfigDto,
  ModelProviderCatalogEntryDto,
  ModelProviderConfigDto,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {screen, userEvent, within} from 'storybook/test';
import {WorkspaceModelProvidersSection} from './model-providers-section.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

type Scenario =
  | 'mixed'
  | 'empty-configured'
  | 'all-configured'
  | 'custom-configured'
  | 'loading'
  | 'configs-error'
  | 'catalog-error'
  | 'managed-only'
  | 'long-names';

interface ModelProvidersStoryProps {
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

function ModelProvidersStory({scenario}: ModelProvidersStoryProps) {
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
      <div className="mx-auto w-full max-w-[760px] bg-background-subtle-base p-24">
        <WorkspaceModelProvidersSection workspaceId={WORKSPACE_ID} />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Agent/ProviderSettings',
  component: ModelProvidersStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'mixed'},
} satisfies Meta<typeof ModelProvidersStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const ManagedOnly: Story = {
  args: {scenario: 'managed-only'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText('Managed by this instance. No workspace credentials are required.');
    await canvas.findByRole('button', {name: 'Use in a workflow'});
  },
};

export const EmptyConfigured: Story = {
  args: {scenario: 'empty-configured'},
};

export const AllConfigured: Story = {
  args: {scenario: 'all-configured'},
};

export const CustomConfigured: Story = {
  args: {scenario: 'custom-configured'},
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const ConfigsError: Story = {
  args: {scenario: 'configs-error'},
};

export const CatalogError: Story = {
  args: {scenario: 'catalog-error'},
};

export const LongNames: Story = {
  args: {scenario: 'long-names'},
};

export const FilteredAvailableProviders: Story = {
  args: {scenario: 'empty-configured'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('searchbox', {name: 'Search providers'}),
      'openrouter',
    );
    await canvas.findByRole('button', {name: 'Configure OpenRouter'});
  },
};

export const NoMatchingAvailableProviders: Story = {
  args: {scenario: 'empty-configured'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('searchbox', {name: 'Search providers'}),
      'not-a-provider',
    );
    await canvas.findByRole('button', {name: 'Clear search'});
  },
};

export const ConfigureModalOpen: Story = {
  args: {scenario: 'empty-configured'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Configure Anthropic'}));
    await screen.findByLabelText('API key');
  },
};

export const CustomProviderModalOpen: Story = {
  args: {scenario: 'empty-configured'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Configure custom provider'}));
    await screen.findByRole('dialog', {name: 'Add custom provider'});
  },
};

export const WorkflowExampleModalOpen: Story = {
  args: {scenario: 'mixed'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', {name: 'Open Anthropic provider actions'}),
    );
    await userEvent.click(await screen.findByRole('menuitem', {name: 'View workflow example'}));
    await screen.findByRole('dialog', {name: 'Use Anthropic in a workflow'});
  },
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (url.pathname.endsWith('/agent/model-provider-catalog')) {
      if (scenario === 'catalog-error') return Promise.resolve(errorResponse());
      return Promise.resolve(
        jsonResponse({
          providers: catalogForScenario(scenario),
          ...(scenario === 'managed-only'
            ? {workspace_providers: 'disabled', managed_provider_id: 'shipfox'}
            : {}),
        }),
      );
    }
    if (url.pathname.endsWith('/agent/model-providers')) {
      if (scenario === 'configs-error') return Promise.resolve(errorResponse());
      return Promise.resolve(jsonResponse(configsForScenario(scenario)));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function catalogForScenario(scenario: Scenario): ModelProviderCatalogEntryDto[] {
  if (scenario === 'managed-only') {
    return [
      providerEntry({
        id: 'shipfox',
        label: 'Shipfox Managed',
        default_model: 'claude-opus-4-8',
        credential_fields: [],
        models: [
          {id: 'claude-opus-4-8', label: 'Claude Opus 4.8', api: 'anthropic-messages'},
          {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', api: 'openai-responses'},
        ],
      }),
    ];
  }
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

function configsForScenario(scenario: Scenario) {
  if (scenario === 'managed-only') {
    return {configs: [], default_provider_id: null, default_harness_id: null};
  }
  if (scenario === 'empty-configured' || scenario === 'configs-error') {
    return {configs: [], default_provider_id: null, default_harness_id: null};
  }
  if (scenario === 'all-configured') {
    return {
      configs: CATALOG.filter((entry) => entry.support_status === 'supported').map((entry) =>
        providerConfig({
          provider_id: entry.id as SupportedModelProviderId,
        }),
      ),
      default_provider_id: 'anthropic',
      default_harness_id: null,
    };
  }
  if (scenario === 'custom-configured') {
    return {
      configs: [providerConfig({provider_id: 'anthropic'}), customProviderConfig()],
      default_provider_id: 'local-vllm',
      default_harness_id: null,
    };
  }
  return {
    configs: [providerConfig({provider_id: 'anthropic'})],
    default_provider_id: 'anthropic',
    default_harness_id: null,
  };
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
    models: [
      {id: 'llama-3.1', label: 'Llama 3.1'},
      {id: 'qwen-coder', label: 'Qwen Coder'},
    ],
    default_model: 'llama-3.1',
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };
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
