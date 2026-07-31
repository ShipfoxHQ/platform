// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  dismissModelProviderOnboarding,
  modelProviderConfigsQueryOptions,
} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {sourceConnectionsQueryOptions} from '@shipfox/client-integrations';
import {projectExistenceQueryOptions} from '@shipfox/client-projects';
import {
  WorkspaceLayoutErrorRoute,
  WorkspaceSetupPending,
  type WorkspaceSetupState,
} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {afterEach, beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {QueryClient} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouteContext,
} from '@tanstack/react-router';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {loadWorkspaceSetupRoute} from './workspace-setup-route.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function sourceConnection(overrides: {lifecycle_status?: string} = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    external_account_id: 'acct',
    slug: 'github_acct',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// The query cache stores the mapped domain shape (camelCase), not the wire
// DTO `sourceConnection()` mocks for fetch responses — keep this seed in sync
// with `toIntegrationConnection` in client-integrations.
function cachedSourceConnection() {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: WORKSPACE_ID,
    provider: 'github',
    externalAccountId: 'acct',
    slug: 'github_acct',
    displayName: 'GitHub',
    lifecycleStatus: 'active' as const,
    capabilities: ['source_control' as const],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

interface SetupFetchOptions {
  projects?: unknown[];
  connections?: unknown[];
  providerConfigs?: unknown[];
  defaultProviderId?: string | null;
  projectsFail?: boolean;
  connectionsFail?: boolean;
  providerConfigsFail?: boolean;
  projectsPending?: boolean;
  workspaceStatus?: 'active' | 'suspended' | 'deleted';
}

function setupFetch(options: SetupFetchOptions = {}) {
  const {
    projects = [],
    connections = [],
    providerConfigs = [modelProviderConfig()],
    defaultProviderId = 'anthropic',
    projectsFail = false,
    connectionsFail = false,
    providerConfigsFail = false,
    projectsPending = false,
    workspaceStatus = 'active',
  } = options;

  return vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith('/workspaces')) {
      return Promise.resolve(
        jsonResponse({
          memberships: [
            {
              id: MEMBERSHIP_ID,
              user_id: USER_ID,
              workspace_id: WORKSPACE_ID,
              workspace_name: 'Workspace',
              workspace_slug: 'workspace',
              workspace_status: workspaceStatus,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      );
    }
    if (url.includes('/projects?')) {
      if (projectsPending) return new Promise<Response>(() => undefined);
      if (projectsFail) return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({projects, next_cursor: null}));
    }
    if (url.includes('/integration-connections?')) {
      if (connectionsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({connections}));
    }
    if (url.endsWith('/agent/model-providers')) {
      if (providerConfigsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(
        jsonResponse({
          configs: providerConfigs,
          default_provider_id: defaultProviderId,
          default_harness_id: null,
        }),
      );
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

function renderSetupRoute(
  path: string,
  fetchImpl: ReturnType<typeof setupFetch>,
  options: {seedQueryClient?: (queryClient: QueryClient) => void} = {},
) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  options.seedQueryClient?.(queryClient);

  const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
    component: Outlet,
  });
  const guardedRoute = (routePath: string, label: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      beforeLoad: ({context, location, params}) =>
        loadWorkspaceSetupRoute({
          queryClient: context.queryClient,
          workspaceId: (params as {wid: string}).wid,
          pathname: location.pathname,
        }),
      pendingComponent: FullPageLoader,
      errorComponent: WorkspaceLayoutErrorRoute,
      component: () => <GuardedRoute label={label} />,
    });
  const routeTree = rootRoute.addChildren([
    guardedRoute('/workspaces/$wid', 'Workspace home'),
    guardedRoute('/workspaces/$wid/model-provider', 'Model provider onboarding'),
    guardedRoute('/workspaces/$wid/integrations', 'VCS onboarding'),
    guardedRoute('/workspaces/$wid/integrations/gitea', 'Gitea install'),
    guardedRoute('/workspaces/$wid/projects/new', 'Create project'),
    guardedRoute('/workspaces/$wid/settings/agents', 'Settings agents'),
    guardedRoute('/workspaces/$wid/settings/integrations', 'Settings integrations'),
  ]);
  const router = createRouter({
    defaultPendingMs: 0,
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree,
    context: {queryClient},
  });

  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

  return {
    queryClient,
    router,
    ...render(<RouterProvider router={router} context={{queryClient}} />),
  };
}

function GuardedRoute({label}: {label: string}) {
  const setupState = useRouteContext({strict: false}) as WorkspaceSetupState;

  return (
    <>
      <div data-testid="project-navigation">
        {setupState.hideProjectNavigation ? 'hidden' : 'visible'}
      </div>
      <main>{setupState.unavailable ? 'Workspace unavailable' : label}</main>
    </>
  );
}

function projectStub() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    workspace_id: WORKSPACE_ID,
    name: 'Platform',
    slug: 'platform',
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function modelProviderConfig() {
  return {
    kind: 'builtin',
    provider_id: 'anthropic',
    default_model: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function calledUrls(fetchImpl: ReturnType<typeof setupFetch>) {
  return fetchImpl.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input),
  );
}

describe('workspace setup route hook', () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.localStorage.clear();
  });

  test('renders a loader while the project existence query is pending', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsPending: true}));

    expect(await screen.findByRole('status', {name: 'Loading'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('renders a retryable setup-status error when the project query fails', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test.each([
    'suspended',
    'deleted',
  ] as const)('stops workspace setup for a %s workspace before loading workspace data', async (workspaceStatus) => {
    const fetchImpl = setupFetch({workspaceStatus, projectsPending: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Workspace unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
    expect(calledUrls(fetchImpl).some((url) => url.includes('/projects?'))).toBe(false);
  });

  test('allows normal workspace content and skips source connections when a project exists', async () => {
    const fetchImpl = setupFetch({projects: [projectStub()]});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
    expect(calledUrls(fetchImpl).some((url) => url.includes('/integration-connections?'))).toBe(
      false,
    );
  });

  test('keeps cached completed-workspace state when the project refetch fails', async () => {
    const fetchImpl = setupFetch({projectsFail: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl, {
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData(projectExistenceQueryOptions(WORKSPACE_ID).queryKey, {
          projects: [projectStub()] as never,
          nextCursor: null,
        });
        // Existence has a freshness window, so explicit invalidation forces the
        // refetch whose failure exercises the cached fallback.
        void queryClient.invalidateQueries({
          queryKey: projectExistenceQueryOptions(WORKSPACE_ID).queryKey,
        });
      },
    });

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    await waitFor(() =>
      expect(calledUrls(fetchImpl).some((url) => url.includes('/projects?'))).toBe(true),
    );
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('sends a workspace with no active VCS to source-control onboarding', async () => {
    const fetchImpl = setupFetch({
      connections: [sourceConnection({lifecycle_status: 'disabled'})],
    });

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('VCS onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('keeps integrations settings available before source-control onboarding', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/settings/integrations`,
      setupFetch({connections: []}),
    );

    expect(await screen.findByText('Settings integrations')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('sends a workspace with active VCS and no project to project creation', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({connections: [sourceConnection()]}),
    );

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('sends a source-connected workspace with no provider config to provider onboarding', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({
        connections: [sourceConnection()],
        providerConfigs: [],
        defaultProviderId: null,
      }),
    );

    expect(await screen.findByText('Model provider onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('keeps the provider onboarding route available while provider setup is pending', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/model-provider`,
      setupFetch({
        connections: [sourceConnection()],
        providerConfigs: [],
        defaultProviderId: null,
      }),
    );

    expect(await screen.findByText('Model provider onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('keeps model provider settings available before first project creation', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/settings/agents`,
      setupFetch({
        connections: [sourceConnection()],
        providerConfigs: [],
        defaultProviderId: null,
      }),
    );

    expect(await screen.findByText('Settings agents')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('uses a dismissed provider step without fetching provider configs', async () => {
    const fetchImpl = setupFetch({connections: [sourceConnection()]});
    dismissModelProviderOnboarding(WORKSPACE_ID);

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    expect(calledUrls(fetchImpl).some((url) => url.endsWith('/agent/model-providers'))).toBe(false);
  });

  test('uses cached provider config state when the provider config refetch fails', async () => {
    const fetchImpl = setupFetch({connections: [sourceConnection()], providerConfigsFail: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl, {
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData(modelProviderConfigsQueryOptions(WORKSPACE_ID).queryKey, {
          configs: [
            {
              kind: 'builtin',
              providerId: 'anthropic',
              defaultModel: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          defaultProviderId: 'anthropic',
          defaultHarnessId: null,
        });
      },
    });

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    await waitFor(() =>
      expect(calledUrls(fetchImpl).some((url) => url.endsWith('/agent/model-providers'))).toBe(
        true,
      ),
    );
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
  });

  test('fails open to project creation when provider configs cannot load without cache', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}`,
      setupFetch({connections: [sourceConnection()], providerConfigsFail: true}),
    );

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
  });

  test('keeps cached source-connection state when the source refetch fails', async () => {
    const fetchImpl = setupFetch({connectionsFail: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl, {
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData(sourceConnectionsQueryOptions(WORKSPACE_ID).queryKey, [
          cachedSourceConnection(),
        ]);
      },
    });

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    await waitFor(() =>
      expect(calledUrls(fetchImpl).some((url) => url.includes('/integration-connections?'))).toBe(
        true,
      ),
    );
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('redirects the completed workspace integrations index to settings integrations', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Settings integrations')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('keeps completed workspace integration install routes available', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations/gitea`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Gitea install')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('renders a retryable setup-status error when the source connection query fails', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({connectionsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('recovers workspace content when Retry re-runs the route load', async () => {
    let projectAttempts = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(
          jsonResponse({
            memberships: [
              {
                id: MEMBERSHIP_ID,
                user_id: USER_ID,
                workspace_id: WORKSPACE_ID,
                workspace_name: 'Workspace',
                workspace_slug: 'workspace',
                workspace_status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      if (url.includes('/projects?')) {
        projectAttempts += 1;
        if (projectAttempts === 1)
          return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
        return Promise.resolve(jsonResponse({projects: [projectStub()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}, {status: 404}));
    });

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    fireEvent.click(await screen.findByRole('button', {name: 'Retry'}));

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
  });

  test('re-evaluates the guard on navigation between children without refetching fresh existence', async () => {
    const fetchImpl = setupFetch({projects: [projectStub()]});
    const {router} = renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();

    await act(async () => {
      await router.navigate({
        to: '/workspaces/$wid/integrations',
        params: {wid: WORKSPACE_ID},
      });
    });

    expect(await screen.findByText('Settings integrations')).toBeInTheDocument();
    expect(calledUrls(fetchImpl).filter((url) => url.includes('/projects?'))).toHaveLength(1);
  });

  test('refetches stale project existence so external project creation can complete setup', async () => {
    let projects = [] as unknown[];
    const fetchImpl = setupFetch({connections: [sourceConnection()]});
    fetchImpl.mockImplementation((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(
          jsonResponse({
            memberships: [
              {
                id: MEMBERSHIP_ID,
                user_id: USER_ID,
                workspace_id: WORKSPACE_ID,
                workspace_name: 'Workspace',
                workspace_slug: 'workspace',
                workspace_status: 'active',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          }),
        );
      }
      if (url.includes('/projects?')) {
        return Promise.resolve(jsonResponse({projects, next_cursor: null}));
      }
      if (url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [sourceConnection()]}));
      }
      return Promise.resolve(jsonResponse({}, {status: 404}));
    });
    const {queryClient, router} = renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    projects = [projectStub()];
    queryClient.setQueryData(
      projectExistenceQueryOptions(WORKSPACE_ID).queryKey,
      {projects: [], nextCursor: null},
      {updatedAt: Date.now() - 31_000},
    );

    await act(async () => {
      await router.navigate({
        to: '/workspaces/$wid',
        params: {wid: WORKSPACE_ID},
      });
    });

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(calledUrls(fetchImpl).filter((url) => url.includes('/projects?'))).toHaveLength(2);
  });

  test('uses a generic workspace error for descendant route failures', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
      component: Outlet,
    });
    const throwingRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workspaces/$wid',
      beforeLoad: () => ({hideProjectNavigation: false}),
      errorComponent: WorkspaceLayoutErrorRoute,
      component: ThrowingWorkspaceRoute,
    });
    const router = createRouter({
      defaultPendingMs: 0,
      history: createMemoryHistory({initialEntries: [`/workspaces/${WORKSPACE_ID}`]}),
      routeTree: rootRoute.addChildren([throwingRoute]),
      context: {queryClient},
    });

    render(<RouterProvider router={router} context={{queryClient}} />);

    expect(await screen.findByText('Could not load workspace')).toBeInTheDocument();
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
  });

  test('shows the pending loader while setup state is unresolved (auth-loading parity)', async () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
      component: Outlet,
    });
    const layoutRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workspaces/$wid',
      beforeLoad: () => undefined,
      component: WorkspaceLayoutParity,
    });
    const router = createRouter({
      defaultPendingMs: 0,
      history: createMemoryHistory({initialEntries: [`/workspaces/${WORKSPACE_ID}`]}),
      routeTree: rootRoute.addChildren([layoutRoute]),
      context: {queryClient},
    });

    render(<RouterProvider router={router} context={{queryClient}} />);

    expect(await screen.findByRole('status', {name: 'Loading'})).toBeInTheDocument();
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  });
});

// Mirrors the _layout route component: while auth is loading, beforeLoad returns
// undefined, so the route context carries no setup state and the layout shows a
// loader instead of protected content. Guards the TanStack contract (undefined
// beforeLoad leaves the key absent) that the production sentinel depends on.
function WorkspaceLayoutParity() {
  const setupState = useRouteContext({strict: false}) as Partial<WorkspaceSetupState>;
  if (setupState.hideProjectNavigation === undefined) return <WorkspaceSetupPending />;

  return <main>Protected content</main>;
}

function ThrowingWorkspaceRoute(): never {
  throw new Error('Descendant route failed');
}
