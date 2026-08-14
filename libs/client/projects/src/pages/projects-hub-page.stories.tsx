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
import {ProjectsHubPage} from './projects-hub-page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

type Scenario = 'list' | 'empty' | 'loading' | 'error';

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

function ProjectsHubPageStory({scenario}: {scenario: Scenario}) {
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
  title: 'Projects/ProjectsHubPage',
  component: ProjectsHubPageStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'list'},
} satisfies Meta<typeof ProjectsHubPageStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Empty: Story = {
  args: {scenario: 'empty'},
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const ErrorState: Story = {
  args: {scenario: 'error'},
};

function createStoryRouter() {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: ProjectsHubPage,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme']}),
    routeTree: rootRoute.addChildren([workspaceRoute]),
  });
}

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input) => {
    const url = requestUrl(input);

    if (url.pathname.endsWith('/agent/model-providers')) {
      return Promise.resolve(
        jsonResponse({
          configs: [
            {
              kind: 'builtin',
              provider_id: 'anthropic',
              default_model: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          default_provider_id: 'anthropic',
          default_harness_id: null,
        }),
      );
    }

    if (url.pathname === '/integration-connections') {
      return Promise.resolve(
        jsonResponse({
          connections: [
            {
              id: CONNECTION_ID,
              workspace_id: WORKSPACE_ID,
              provider: 'github',
              external_account_id: 'octo',
              slug: 'github_octo',
              display_name: 'Acme GitHub',
              lifecycle_status: 'active',
              capabilities: ['source_control'],
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      );
    }

    if (url.pathname === '/projects') {
      if (scenario === 'loading') {
        return new Promise<Response>(() => {
          // Keep the request pending to show the initial skeleton.
        });
      }
      if (scenario === 'error') {
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      }
      if (scenario === 'empty') {
        return Promise.resolve(jsonResponse({projects: [], next_cursor: null}));
      }

      return Promise.resolve(
        jsonResponse({
          projects: [
            projectForStory('Platform', '11111111-1111-4111-8111-111111111112'),
            projectForStory('Agent', '11111111-1111-4111-8111-111111111113'),
            projectForStory('Workflows', '11111111-1111-4111-8111-111111111114'),
          ],
          next_cursor: null,
        }),
      );
    }

    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function projectForStory(name: string, id: string) {
  return {
    id,
    workspace_id: WORKSPACE_ID,
    name,
    slug: name.toLowerCase(),
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: `github:octo/${name.toLowerCase()}`,
    },
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
