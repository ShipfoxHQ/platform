import type {ModelProviderConfigDto} from '@shipfox/api-agent-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {WorkspaceHarnessesSection} from './harnesses-section.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

type Scenario =
  | 'default-pi'
  | 'default-claude'
  | 'claude-unavailable'
  | 'default-claude-unavailable'
  | 'loading'
  | 'error';

interface HarnessesStoryProps {
  scenario: Scenario;
}

function HarnessesStory({scenario}: HarnessesStoryProps) {
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
        <WorkspaceHarnessesSection workspaceId={WORKSPACE_ID} />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Agent/HarnessSettings',
  component: HarnessesStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'default-pi'},
} satisfies Meta<typeof HarnessesStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DefaultClaude: Story = {
  args: {scenario: 'default-claude'},
};

export const ClaudeUnavailable: Story = {
  args: {scenario: 'claude-unavailable'},
};

export const DefaultClaudeUnavailable: Story = {
  args: {scenario: 'default-claude-unavailable'},
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const ErrorState: Story = {
  args: {scenario: 'error'},
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return () => {
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (scenario === 'error') return Promise.resolve(errorResponse());
    return Promise.resolve(jsonResponse(configsForScenario(scenario)));
  };
}

function configsForScenario(scenario: Scenario) {
  if (scenario === 'claude-unavailable') {
    return {
      configs: [providerConfig({provider_id: 'openai'})],
      default_provider_id: 'openai',
      default_harness_id: null,
    };
  }
  if (scenario === 'default-claude-unavailable') {
    return {
      configs: [providerConfig({provider_id: 'openai'})],
      default_provider_id: 'openai',
      default_harness_id: 'claude',
    };
  }
  return {
    configs: [providerConfig({provider_id: 'anthropic'})],
    default_provider_id: 'anthropic',
    default_harness_id: scenario === 'default-claude' ? 'claude' : null,
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
