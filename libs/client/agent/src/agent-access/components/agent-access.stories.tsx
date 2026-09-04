import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-shell/runtime';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {type ReactNode, useEffect, useState} from 'react';
import {within} from 'storybook/test';
import {AgentAccessSettingsPage} from './agent-access-settings-page.js';
import {OAuthConsentPage} from './oauth-consent-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

type View =
  | 'consent'
  | 'consent-multiple-workspaces'
  | 'settings-populated'
  | 'settings-empty'
  | 'settings-errors';

const STORY_WORKSPACES = [
  {id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'},
  {
    id: SECOND_WORKSPACE_ID,
    name: 'Research Lab',
    slug: 'research-lab',
    membershipId: 'membership-2',
  },
] as const;

function AgentAccessStory({view}: {view: View}) {
  if (view === 'consent' || view === 'consent-multiple-workspaces') {
    return <OAuthConsentPage requestId={REQUEST_ID} onRedirect={() => undefined} />;
  }

  return (
    <StorySurface>
      <AgentAccessSettingsPage workspaceId={WORKSPACE_ID} />
    </StorySurface>
  );
}

const withStoryProviders: Decorator = (Story, context) => (
  <StoryProviders key={context.args.view as View} view={context.args.view as View}>
    <Story />
  </StoryProviders>
);

function StoryProviders({children, view}: {children: ReactNode; view: View}) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [store] = useState(() => {
    const nextStore = createStore();
    const authState: AuthState = {
      status: 'authenticated',
      workspaces:
        view === 'consent-multiple-workspaces' ? [...STORY_WORKSPACES] : [STORY_WORKSPACES[0]],
    };
    nextStore.set(authStateAtom, authState);
    return nextStore;
  });
  const [configuredView, setConfiguredView] = useState<View>();

  useEffect(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: fetchForView(view),
    });
    setConfiguredView(view);

    return () => {
      resetApiClient();
    };
  }, [view]);

  if (configuredView !== view) return null;
  return (
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  );
}

const meta = {
  title: 'MCP connections/Surfaces',
  component: AgentAccessStory,
  parameters: {layout: 'fullscreen'},
  decorators: [withStoryProviders],
  args: {view: 'consent'},
} satisfies Meta<typeof AgentAccessStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Consent: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('heading', {name: 'Allow Claude Desktop to access Shipfox?'});
    await canvas.findByText('Acme');
    await canvas.findByText('Claude Desktop on this device');
    await canvas.findByText('Read workspace data');
    await canvas.findByRole('button', {name: 'Allow access'});
  },
};

export const MultipleWorkspaces: Story = {
  args: {view: 'consent-multiple-workspaces'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('radio', {name: 'Acme'});
    await canvas.findByRole('radio', {name: 'Research Lab'});
  },
};

export const Settings: Story = {
  args: {view: 'settings-populated'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText('Claude Desktop');
    await canvas.findByRole('heading', {name: 'Connected apps'});
  },
};

export const EmptySettings: Story = {
  args: {view: 'settings-empty'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText('No connected apps');
  },
};

export const SettingsErrors: Story = {
  args: {view: 'settings-errors'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Couldn't load connected apps");
  },
};

function StorySurface({children}: {children: React.ReactNode}) {
  return (
    <main className="min-h-screen bg-background-subtle-base p-frame">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-section">{children}</div>
    </main>
  );
}

function fetchForView(view: View): typeof fetch {
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
      return Promise.resolve(jsonResponse(consentDto(view === 'consent-multiple-workspaces')));
    }
    if (request.url.endsWith('/grants')) {
      return Promise.resolve(jsonResponse({grants: view === 'settings-empty' ? [] : [grantDto()]}));
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

function consentDto(multipleWorkspaces = false) {
  return {
    request_id: REQUEST_ID,
    client_name: 'Claude Desktop',
    scope: 'read',
    expires_at: '2026-09-02T12:30:00.000Z',
    redirect_uri_hostname: '127.0.0.1',
    client_identity_origin: 'https://claude.ai',
    is_loopback_redirect: true,
    workspaces: [
      {workspace_id: WORKSPACE_ID, role: 'owner'},
      ...(multipleWorkspaces ? [{workspace_id: SECOND_WORKSPACE_ID, role: 'member'}] : []),
    ],
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
