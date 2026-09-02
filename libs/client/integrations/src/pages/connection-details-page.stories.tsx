import type {
  IntegrationConnectionDto,
  IntegrationConnectionRepositoryAccessResponseDto,
} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useMemo} from 'react';
import {expect, within} from 'storybook/test';
import {ConnectionDetailsPage} from './connection-details-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_PATH = '/w/acme/settings/integrations/github_acme_corp';
const REPOSITORY_ACCESS_PATH = `/integration-connections/${CONNECTION_ID}/repository-access`;
const SELECTED_MODE_RE = /Only your projects' repositories/u;
const ALL_MODE_RE = /Every repository this integration can access/u;
const GITEA_INTRO_RE = /it was given on Gitea/u;
const GITHUB_LINK_RE = /on GitHub/u;

type Scenario = 'selected' | 'all' | 'empty-selected' | 'gitea';

interface ConnectionDetailsPageStoryProps {
  scenario: Scenario;
}

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'platform@example.com',
    name: 'Platform Engineer',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  },
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
};

const connection = {
  id: CONNECTION_ID,
  workspace_id: WORKSPACE_ID,
  provider: 'github',
  external_account_id: 'acme-corp',
  slug: 'github_acme_corp',
  display_name: 'Acme Corp GitHub',
  lifecycle_status: 'active',
  capabilities: ['source_control'],
  external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
} satisfies IntegrationConnectionDto;

const giteaConnection = {
  ...connection,
  provider: 'gitea',
  external_account_id: 'acme-corp',
  display_name: 'Acme Corp Gitea',
  external_url: undefined,
} satisfies IntegrationConnectionDto;

const selectedRepositories: IntegrationConnectionRepositoryAccessResponseDto['repositories'] = [
  {
    external_repository_id: 'platform',
    owner: 'acme-corp',
    name: 'platform',
    project_id: PROJECT_ID,
    project_name: 'Platform',
    project_slug: 'platform',
  },
  {
    external_repository_id: 'agent-tools',
    owner: 'acme-corp',
    name: 'agent-tools',
    project_id: PROJECT_ID,
    project_name: 'Agent tools',
    project_slug: 'agent-tools',
  },
  {
    external_repository_id: 'workflow-runners',
    owner: 'acme-corp',
    name: 'workflow-runners',
    project_id: PROJECT_ID,
    project_name: 'Workflow runners',
    project_slug: 'workflow-runners',
  },
];

function ConnectionDetailsPageStory({scenario}: ConnectionDetailsPageStoryProps) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, authState);
    return nextStore;
  }, []);
  const router = useMemo(() => createStoryRouter(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <div className="min-h-screen bg-background-subtle-base px-24 py-32">
          <div className="mx-auto w-full max-w-[760px]">
            <RouterProvider router={router} />
          </div>
        </div>
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Integrations/ConnectionDetailsPage',
  component: ConnectionDetailsPageStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'selected'},
} satisfies Meta<typeof ConnectionDetailsPageStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('radio', {name: SELECTED_MODE_RE})).toBeChecked();
  },
};

export const AllInstallationRepositories: Story = {
  args: {scenario: 'all'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('radio', {name: ALL_MODE_RE})).toBeChecked();
  },
};

export const GiteaConnection: Story = {
  args: {scenario: 'gitea'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('radio', {name: ALL_MODE_RE})).toBeInTheDocument();
    expect(canvas.getByText(GITEA_INTRO_RE)).toBeVisible();
    expect(canvas.queryByRole('link', {name: GITHUB_LINK_RE})).not.toBeInTheDocument();
  },
};

export const EmptySelectedRepositories: Story = {
  args: {scenario: 'empty-selected'},
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await canvas.findByText('No project repositories yet');
  },
};

function createStoryRouter() {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: Outlet,
  });
  const connectionDetailsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/integrations/$connectionSlug',
    component: () => (
      <ConnectionDetailsPage workspaceSlug="acme" connectionSlug="github_acme_corp" />
    ),
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/integrations',
    component: () => <div />,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [WORKSPACE_PATH]}),
    routeTree: rootRoute.addChildren([
      workspaceRoute.addChildren([connectionDetailsRoute, integrationsRoute]),
    ]),
  });
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === '/integration-connections') {
      return jsonResponse({connections: [scenario === 'gitea' ? giteaConnection : connection]});
    }
    if (url.pathname === REPOSITORY_ACCESS_PATH) {
      if (request.method === 'PUT') {
        const body = (await request.json()) as {mode: 'selected' | 'all'};
        return jsonResponse({mode: body.mode});
      }
      return jsonResponse(repositoryAccessForScenario(scenario));
    }

    return jsonResponse({}, {status: 404});
  };
}

function repositoryAccessForScenario(
  scenario: Scenario,
): IntegrationConnectionRepositoryAccessResponseDto {
  return {
    mode: scenario === 'all' ? 'all' : 'selected',
    repositories: scenario === 'empty-selected' ? [] : selectedRepositories,
    next_cursor: null,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
