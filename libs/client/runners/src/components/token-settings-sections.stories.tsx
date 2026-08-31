import type {ManualRegistrationTokenDto, ProvisionerTokenDto} from '@shipfox/api-runners-dto';
import {configureApiClient} from '@shipfox/client-api';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {Toaster} from '@shipfox/react-ui/toast';
import {Code} from '@shipfox/react-ui/typography';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import {within} from 'storybook/test';
import type {
  CreatedProvisionerToken,
  ManualRegistrationToken,
  ProvisionerToken,
} from '#core/token.js';
import {CreatedManualRegistrationTokenPanel} from './create-manual-registration-token-form.js';
import {CreatedProvisionerTokenPanel} from './create-provisioner-token-form.js';
import {
  EmptyManualRegistrationTokens,
  ManualRegistrationTokenList,
  ManualRegistrationTokenTableSkeleton,
} from './manual-registration-token-list.js';
import {WorkspaceManualRegistrationTokensSettingsSection} from './manual-registration-tokens-settings-section.js';
import {
  EmptyProvisionerTokens,
  ProvisionerTokenList,
  ProvisionerTokenTableSkeleton,
} from './provisioner-token-list.js';
import {WorkspaceProvisionerTokensSettingsSection} from './provisioner-tokens-settings-section.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-06-26T12:00:00.000Z';
const EIGHT_MINUTES_AGO = '2026-06-26T11:52:00.000Z';
const EXPIRES_AT = '2026-09-24T12:00:00.000Z';
const CREATED_AT = '2026-06-20T12:00:00.000Z';

type Scenario = 'populated' | 'empty' | 'loading' | 'errors';

interface TokenSettingsSectionsStoryProps {
  scenario: Scenario;
}

const withQueryClient: Decorator = (Story) => {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return (
    <QueryClientProvider client={queryClient}>
      <RelativeTimeProvider>
        <Story />
      </RelativeTimeProvider>
      <Toaster />
    </QueryClientProvider>
  );
};

function TokenSettingsSectionsStory({scenario}: TokenSettingsSectionsStoryProps) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  return (
    <StorySurface>
      <WorkspaceManualRegistrationTokensSettingsSection workspaceId={WORKSPACE_ID} />
      <WorkspaceProvisionerTokensSettingsSection workspaceId={WORKSPACE_ID} />
    </StorySurface>
  );
}

const meta = {
  title: 'Runners/TokenSettingsSections',
  component: TokenSettingsSectionsStory,
  parameters: {layout: 'fullscreen'},
  decorators: [withQueryClient],
  args: {scenario: 'populated'},
} satisfies Meta<typeof TokenSettingsSectionsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText('Deploy runner');
    await canvas.findAllByText('Docker autoscaler');
    await canvas.findAllByText('Connected');
    await canvas.findAllByText('Never connected');
  },
};

export const DataStates: Story = {
  render: () => (
    <StorySurface>
      <StateExample label="Manual empty">
        <EmptyManualRegistrationTokens />
      </StateExample>
      <StateExample label="Manual loading">
        <ManualRegistrationTokenTableSkeleton />
      </StateExample>
      <StateExample label="Provisioner empty">
        <EmptyProvisionerTokens />
      </StateExample>
      <StateExample label="Provisioner loading">
        <ProvisionerTokenTableSkeleton />
      </StateExample>
    </StorySurface>
  ),
};

export const Errors: Story = {
  args: {scenario: 'errors'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Couldn't load manual registration tokens");
    await canvas.findByText("Couldn't load provisioner registration tokens");
  },
};

export const Statuses: Story = {
  render: () => (
    <StorySurface>
      <ProvisionerTokenList
        workspaceId={WORKSPACE_ID}
        tokens={[
          provisionerTokenModel({
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Docker autoscaler',
            lastSeenAt: NOW,
          }),
          provisionerTokenModel({
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Kubernetes spot pool',
            lastSeenAt: EIGHT_MINUTES_AGO,
          }),
          provisionerTokenModel({
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Buildkite migration pool',
            lastSeenAt: null,
          }),
        ]}
        activeIds={new Set(['33333333-3333-4333-8333-333333333333'])}
      />
    </StorySurface>
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText('Connected');
    await canvas.findAllByText('Last seen');
    await canvas.findAllByText('Never connected');
  },
};

export const Content: Story = {
  render: () => (
    <StorySurface>
      <StateExample label="Existing tokens">
        <div className="flex flex-col gap-24">
          <ManualRegistrationTokenList
            workspaceId={WORKSPACE_ID}
            tokens={[
              manualRegistrationToken({name: 'Deploy runner', prefix: 'sf_mrt_deploy'}),
              manualRegistrationToken({
                id: '66666666-6666-4666-8666-666666666666',
                name: 'macOS build host',
                prefix: 'sf_mrt_macos',
                expiresAt: null,
              }),
            ]}
          />
          <ProvisionerTokenList
            workspaceId={WORKSPACE_ID}
            tokens={provisionerTokenModels()}
            activeIds={new Set(['33333333-3333-4333-8333-333333333333'])}
          />
        </div>
      </StateExample>
      <StateExample label="Long names">
        <div className="flex flex-col gap-24">
          <ManualRegistrationTokenList
            workspaceId={WORKSPACE_ID}
            tokens={[
              manualRegistrationToken({
                name: 'self-hosted-runner-for-production-release-candidate-validation-on-metal',
                prefix: 'sf_mrt_release_candidate_validation',
              }),
            ]}
          />
          <ProvisionerTokenList
            workspaceId={WORKSPACE_ID}
            tokens={[
              provisionerTokenModel({
                name: 'docker-provisioner-for-west-coast-gpu-burst-capacity-and-fallback',
                prefix: 'sf_pt_west_coast_gpu_burst',
                lastSeenAt: EIGHT_MINUTES_AGO,
              }),
            ]}
            activeIds={new Set()}
          />
        </div>
      </StateExample>
    </StorySurface>
  ),
};

export const CreatedTokenPanels: Story = {
  render: () => (
    <StorySurface>
      <StateExample label="Manual token reveal">
        <CreatedManualRegistrationTokenPanel
          token={{
            id: '77777777-7777-4777-8777-777777777777',
            token: 'sf_mrt_4nJvNrs23ExampleManualTokenValue',
            prefix: 'sf_mrt_4nJv',
            name: 'Deploy runner',
            workspaceId: WORKSPACE_ID,
            expiresAt: EXPIRES_AT,
            createdAt: CREATED_AT,
          }}
        />
      </StateExample>
      <StateExample label="Provisioner token reveal">
        <CreatedProvisionerTokenPanel token={createdProvisionerToken()} />
      </StateExample>
    </StorySurface>
  ),
};

function StorySurface({children}: {children: ReactNode}) {
  return (
    <div className="min-h-screen bg-background-subtle-base p-24">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-32">{children}</div>
    </div>
  );
}

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex flex-col gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-16">
        {children}
      </div>
    </div>
  );
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (url.pathname.endsWith('/runners/manual-registration-tokens')) {
      return manualRegistrationTokensResponse(scenario);
    }
    if (url.pathname.endsWith('/provisioners/tokens')) {
      return provisionerTokensResponse(scenario);
    }
    if (url.pathname.endsWith('/provisioners/active')) {
      return activeProvisionersResponse(scenario);
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function manualRegistrationTokensResponse(scenario: Scenario) {
  if (scenario === 'errors') return Promise.resolve(errorResponse());
  return Promise.resolve(
    jsonResponse({
      manual_registration_tokens: scenario === 'empty' ? [] : [manualToken()],
    }),
  );
}

function provisionerTokensResponse(scenario: Scenario) {
  if (scenario === 'errors') return Promise.resolve(errorResponse());
  return Promise.resolve(jsonResponse({tokens: scenario === 'empty' ? [] : provisionerTokens()}));
}

function activeProvisionersResponse(scenario: Scenario) {
  const provisioners = [
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Docker autoscaler',
      prefix: 'sf_pt_docker',
      last_seen_at: NOW,
    },
  ];
  return Promise.resolve(
    jsonResponse({
      provisioners: scenario === 'empty' ? [] : provisioners,
      installation_runners: 'none',
    }),
  );
}

function provisionerTokens(): ProvisionerTokenDto[] {
  return [
    provisionerToken({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Docker autoscaler',
      prefix: 'sf_pt_docker',
      last_seen_at: NOW,
    }),
    provisionerToken({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Kubernetes spot pool',
      prefix: 'sf_pt_spot',
      last_seen_at: EIGHT_MINUTES_AGO,
    }),
    provisionerToken({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Buildkite migration pool',
      prefix: 'sf_pt_migrate',
      last_seen_at: null,
    }),
  ];
}

function manualRegistrationToken(
  overrides: Partial<ManualRegistrationToken> = {},
): ManualRegistrationToken {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: WORKSPACE_ID,
    prefix: 'sf_mrt_deploy',
    name: 'Deploy runner',
    expiresAt: EXPIRES_AT,
    revokedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function provisionerTokenModel(overrides: Partial<ProvisionerToken> = {}): ProvisionerToken {
  return {
    ...manualRegistrationToken(),
    createdByUserId: '99999999-9999-4999-8999-999999999999',
    revokedByUserId: null,
    lastSeenAt: NOW,
    ...overrides,
  };
}

function provisionerTokenModels(): ProvisionerToken[] {
  return [
    provisionerTokenModel({id: '33333333-3333-4333-8333-333333333333', name: 'Docker autoscaler'}),
    provisionerTokenModel({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Kubernetes spot pool',
      lastSeenAt: EIGHT_MINUTES_AGO,
    }),
    provisionerTokenModel({
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Buildkite migration pool',
      lastSeenAt: null,
    }),
  ];
}

function createdProvisionerToken(): CreatedProvisionerToken {
  return {
    ...provisionerTokenModel({name: 'Docker autoscaler'}),
    token: 'sf_pt_Rv8YwrExampleProvisionerTokenValue',
  };
}

function manualToken(
  overrides: Partial<ManualRegistrationTokenDto> = {},
): ManualRegistrationTokenDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    workspace_id: WORKSPACE_ID,
    prefix: 'sf_mrt_deploy',
    name: 'Deploy runner',
    expires_at: EXPIRES_AT,
    revoked_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function provisionerToken(overrides: Partial<ProvisionerTokenDto> = {}): ProvisionerTokenDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    scope: 'workspace',
    workspace_id: WORKSPACE_ID,
    prefix: 'sf_pt_docker',
    name: 'Docker autoscaler',
    created_by_user_id: '99999999-9999-4999-8999-999999999999',
    revoked_by_user_id: null,
    expires_at: EXPIRES_AT,
    revoked_at: null,
    last_seen_at: NOW,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
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
