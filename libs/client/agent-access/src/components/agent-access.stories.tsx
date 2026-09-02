import {configureApiClient} from '@shipfox/client-api';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {within} from 'storybook/test';
import {AgentAccessSettingsPage, CreatedPersonalAccessToken} from './agent-access-settings-page.js';
import {OAuthConsentPage} from './oauth-consent-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

type View = 'consent' | 'settings-populated' | 'settings-empty' | 'settings-errors' | 'created';

function AgentAccessStory({view}: {view: View}) {
  if (view === 'created') {
    return (
      <StorySurface width="narrow">
        <CreatedPersonalAccessToken token={createdPat()} />
      </StorySurface>
    );
  }

  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForView(view),
  });

  if (view === 'consent') {
    return <OAuthConsentPage requestId={REQUEST_ID} onRedirect={() => undefined} />;
  }

  return (
    <StorySurface>
      <AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />
    </StorySurface>
  );
}

const withQueryClient: Decorator = (Story) => {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return (
    <QueryClientProvider client={queryClient}>
      <Story />
    </QueryClientProvider>
  );
};

const meta = {
  title: 'Agent access/Surfaces',
  component: AgentAccessStory,
  parameters: {layout: 'fullscreen'},
  decorators: [withQueryClient],
  args: {view: 'consent'},
} satisfies Meta<typeof AgentAccessStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Consent: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('heading', {name: 'Allow Claude Desktop to access Shipfox?'});
    await canvas.findByText('Read-only');
    await canvas.findByText('127.0.0.1');
  },
};

export const Settings: Story = {
  args: {view: 'settings-populated'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText('Claude Desktop');
    await canvas.findAllByText('Local coding agent');
  },
};

export const EmptySettings: Story = {
  args: {view: 'settings-empty'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText('No connected agents');
    await canvas.findByText('No personal access tokens');
  },
};

export const SettingsErrors: Story = {
  args: {view: 'settings-errors'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Couldn't load connected agents");
    await canvas.findByText("Couldn't load personal access tokens");
  },
};

export const OneTimeTokenReveal: Story = {args: {view: 'created'}};

function StorySurface({
  children,
  width = 'wide',
}: {
  children: React.ReactNode;
  width?: 'wide' | 'narrow';
}) {
  return (
    <main className="min-h-screen bg-background-subtle-base p-frame">
      <div
        className={
          width === 'narrow'
            ? 'mx-auto max-w-[560px] rounded-8 border border-border-neutral-base bg-background-neutral-base'
            : 'mx-auto flex max-w-[1040px] flex-col gap-section'
        }
      >
        {children}
      </div>
    </main>
  );
}

function fetchForView(view: Exclude<View, 'created'>): typeof fetch {
  return (input) => {
    const request = input as Request;
    if (view === 'settings-errors') {
      return Promise.resolve(
        jsonResponse(
          {code: 'auth-dependency-unavailable', message: 'Temporarily unavailable'},
          {status: 503},
        ),
      );
    }
    if (request.url.includes('/oauth/consents/')) {
      return Promise.resolve(jsonResponse(consentDto()));
    }
    if (request.url.endsWith('/grants')) {
      return Promise.resolve(jsonResponse({grants: view === 'settings-empty' ? [] : [grantDto()]}));
    }
    if (request.url.endsWith('/pats')) {
      return Promise.resolve(jsonResponse({pats: view === 'settings-empty' ? [] : [patDto()]}));
    }
    return Promise.resolve(jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}));
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function consentDto() {
  return {
    request_id: REQUEST_ID,
    client_name: 'Claude Desktop',
    scope: 'read',
    expires_at: '2026-09-02T12:30:00.000Z',
    redirect_uri_hostname: '127.0.0.1',
    client_identity_origin: 'https://claude.ai',
    is_loopback_redirect: true,
    workspaces: [{workspace_id: WORKSPACE_ID, role: 'owner'}],
  };
}

function grantDto() {
  return {
    id: CREDENTIAL_ID,
    client_name: 'Claude Desktop',
    workspace_id: WORKSPACE_ID,
    scopes: ['read'],
    created_at: '2026-08-20T10:00:00.000Z',
    last_refreshed_at: '2026-09-02T10:00:00.000Z',
  };
}

function patDto() {
  return {
    id: CREDENTIAL_ID,
    workspace_id: WORKSPACE_ID,
    prefix: 'sf_pat_9d2bc1',
    name: 'Local coding agent',
    expires_at: '2026-12-01T10:00:00.000Z',
    last_used_at: '2026-09-02T09:45:00.000Z',
    created_at: '2026-09-01T10:00:00.000Z',
  };
}

function createdPat() {
  return {
    id: CREDENTIAL_ID,
    workspaceId: WORKSPACE_ID,
    prefix: 'sf_pat_9d2bc1',
    name: 'Local coding agent',
    expiresAt: '2026-12-01T10:00:00.000Z',
    lastUsedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    token: 'sf_pat_9d2bc1_example_secret_value_shown_once',
  };
}
