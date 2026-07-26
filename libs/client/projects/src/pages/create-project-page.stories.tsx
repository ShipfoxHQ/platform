import type {IntegrationConnectionDto, RepositoryDto} from '@shipfox/api-integration-core-dto';
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
import {CreateProjectPage} from './create-project-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_PATH = `/workspaces/${WORKSPACE_ID}/projects/new`;
const GITHUB_CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const GITEA_CONNECTION_ID = '44444444-4444-4444-8444-444444444444';

type Scenario =
  | 'playground'
  | 'long-names'
  | 'repository-loading'
  | 'empty-repositories'
  | 'connections-error';

interface CreateProjectPageStoryProps {
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
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', membershipId: 'membership-1'}],
};

function CreateProjectPageStory({scenario}: CreateProjectPageStoryProps) {
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
        <div className="min-h-screen bg-background-neutral-background px-24 py-32">
          <div className="mx-auto w-full max-w-[1120px]">
            <RouterProvider router={router} />
          </div>
        </div>
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Projects/CreateProjectPage',
  component: CreateProjectPageStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'playground'},
} satisfies Meta<typeof CreateProjectPageStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const LongNames: Story = {
  args: {scenario: 'long-names'},
};

export const RepositoryLoading: Story = {
  args: {scenario: 'repository-loading'},
};

export const EmptyRepositories: Story = {
  args: {scenario: 'empty-repositories'},
};

export const ConnectionsError: Story = {
  args: {scenario: 'connections-error'},
};

function createStoryRouter() {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid',
    component: Outlet,
  });
  const createProjectRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'projects/new',
    component: CreateProjectPage,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'integrations',
    component: () => <div />,
  });
  const modelProvidersRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/agents',
    component: () => <div />,
  });
  const projectRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'projects/$pid',
    component: () => <div />,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [WORKSPACE_PATH]}),
    routeTree: rootRoute.addChildren([
      workspaceRoute.addChildren([
        createProjectRoute,
        integrationsRoute,
        modelProvidersRoute,
        projectRoute,
      ]),
    ]),
  });
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input);
    const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
    if (url.pathname === `/workspaces/${WORKSPACE_ID}/agent/model-providers`) {
      return Promise.resolve(
        jsonResponse({
          configs: [modelProviderConfig()],
          default_provider_id: 'openai',
          default_harness_id: null,
        }),
      );
    }
    if (url.pathname === '/integration-connections') {
      if (scenario === 'connections-error') return Promise.resolve(errorResponse());
      return Promise.resolve(jsonResponse({connections: connectionsForScenario(scenario)}));
    }
    if (
      url.pathname.startsWith('/integration-connections/') &&
      url.pathname.endsWith('/repositories')
    ) {
      if (scenario === 'repository-loading') return new Promise<Response>(() => undefined);
      return Promise.resolve(
        jsonResponse({repositories: repositoriesForScenario(scenario), next_cursor: null}),
      );
    }
    if (url.pathname === '/projects' && method === 'POST') {
      return Promise.resolve(
        jsonResponse({
          id: '99999999-9999-4999-8999-999999999999',
          workspace_id: WORKSPACE_ID,
          name: 'Platform',
          source: {
            connection_id: GITHUB_CONNECTION_ID,
            external_repository_id: 'platform',
          },
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }),
      );
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function connectionsForScenario(scenario: Scenario): IntegrationConnectionDto[] {
  if (scenario === 'long-names') {
    return [
      connection({
        id: GITHUB_CONNECTION_ID,
        provider: 'github',
        display_name: 'acme-platform-engineering-production',
        external_account_id: 'acme-platform-engineering-production',
      }),
      connection({
        id: GITEA_CONNECTION_ID,
        provider: 'gitea',
        display_name: 'git.internal.acme.example/platform-tools',
        external_account_id: 'git.internal.acme.example/platform-tools',
      }),
    ];
  }

  return [
    connection({
      id: GITHUB_CONNECTION_ID,
      provider: 'github',
      display_name: 'acme',
      external_account_id: 'acme',
    }),
    connection({
      id: GITEA_CONNECTION_ID,
      provider: 'gitea',
      display_name: 'git.acme.internal',
      external_account_id: 'git.acme.internal',
    }),
  ];
}

function repositoriesForScenario(scenario: Scenario): RepositoryDto[] {
  if (scenario === 'empty-repositories') return [];
  if (scenario === 'long-names') {
    return [
      repository({
        external_repository_id: 'acme-platform-infrastructure-control-plane',
        name: 'acme-platform-infrastructure-control-plane',
        full_name: 'acme-engineering/acme-platform-infrastructure-control-plane',
        default_branch: 'production',
      }),
      repository({
        external_repository_id: 'workflow-automation-and-runner-orchestration',
        name: 'workflow-automation-and-runner-orchestration',
        full_name: 'acme-engineering/workflow-automation-and-runner-orchestration',
        default_branch: 'main',
      }),
      repository({
        external_repository_id: 'customer-deployment-pipelines',
        name: 'customer-deployment-pipelines',
        full_name: 'acme-solutions/customer-deployment-pipelines',
        default_branch: 'release',
      }),
      repository({
        external_repository_id: 'observability-and-deployment-automation',
        name: 'observability-and-deployment-automation',
        full_name: 'acme-platform/observability-and-deployment-automation',
        default_branch: 'main',
      }),
    ];
  }

  return [
    repository({
      external_repository_id: 'platform',
      name: 'platform',
      full_name: 'acme/platform',
      default_branch: 'main',
    }),
    repository({
      external_repository_id: 'api',
      name: 'api',
      full_name: 'acme/api',
      default_branch: 'main',
    }),
    repository({
      external_repository_id: 'client',
      name: 'client',
      full_name: 'acme/client',
      default_branch: 'main',
    }),
    repository({
      external_repository_id: 'runners',
      name: 'runners',
      full_name: 'acme/runners',
      default_branch: 'main',
    }),
    repository({
      external_repository_id: 'workflows',
      name: 'workflows',
      full_name: 'acme/workflows',
      default_branch: 'develop',
    }),
  ];
}

function connection(
  overrides: Partial<IntegrationConnectionDto> & Pick<IntegrationConnectionDto, 'id'>,
): IntegrationConnectionDto {
  return {
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    external_account_id: 'acme',
    slug: 'github_acme',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function repository(overrides: Partial<RepositoryDto>): RepositoryDto {
  return {
    connection_id: GITHUB_CONNECTION_ID,
    external_repository_id: 'platform',
    owner: 'acme',
    name: 'platform',
    full_name: 'acme/platform',
    default_branch: 'main',
    visibility: 'private',
    clone_url: 'https://github.example.test/acme/platform.git',
    html_url: 'https://github.example.test/acme/platform',
    ...overrides,
  };
}

function modelProviderConfig() {
  return {
    kind: 'builtin',
    workspace_id: WORKSPACE_ID,
    provider_id: 'openai',
    default_model: 'gpt-5.5-pro',
    credential_fields: ['api_key'],
    lifecycle_status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(input, 'https://api.example.test');
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function errorResponse() {
  return jsonResponse({code: 'server-error'}, {status: 500});
}
