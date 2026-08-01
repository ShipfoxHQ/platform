import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-shell/runtime';
import {Toaster} from '@shipfox/react-ui/toast';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {createStore, Provider as JotaiProvider} from 'jotai';
import type {ReactElement} from 'react';
import {validateWorkflowRunsSearch} from '#routes/inputs.js';

// The workflow run page navigates with the router (run rows are links and the page redirects
// to the first run), so the harness mounts the page under a memory router whose route tree
// carries the `/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId` params the components read. The
// page is supplied as a factory the detail route calls with the current `workflowRunId`, mirroring
// the real route wiring so a redirect re-renders the page with the run it landed on.
export const PROJECT_TEST_WID = '11111111-1111-4111-8111-111111111111';
export const PROJECT_TEST_WSLUG = 'acme';

// Pages that render components depending on `useActiveWorkspace()` (e.g. the project source
// strip) need an authenticated workspace matching `$workspaceSlug` in the atom `client-shell/runtime`
// reads. A fixed membership id is fine here: nothing in these tests asserts on it.
const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  workspaces: [{id: PROJECT_TEST_WID, name: 'Acme', slug: 'acme', membershipId: 'm-1'}],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createTestRouter(
  path: string,
  renderPage: (params: {
    workflowRunId?: string | undefined;
    search: ReturnType<typeof validateWorkflowRunsSearch>;
  }) => ReactElement,
) {
  const rootRoute = createRootRoute({component: Outlet});
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs',
    component: function RunsRoute() {
      return renderPage({
        search: validateWorkflowRunsSearch(useSearch({strict: false}) as Record<string, unknown>),
      });
    },
  });
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: function RunDetailRoute() {
      const {workflowRunId} = useParams({strict: false}) as {workflowRunId?: string};
      return renderPage({
        workflowRunId,
        search: validateWorkflowRunsSearch(useSearch({strict: false}) as Record<string, unknown>),
      });
    },
  });
  const workflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/workflows',
    component: () => renderPage({search: {}}),
  });
  const modelProviderSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agents',
    component: () => <div>Agent settings placeholder</div>,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([
      runsRoute,
      runDetailRoute,
      workflowsRoute,
      modelProviderSettingsRoute,
    ]),
  });
}

export function renderProjectPage(
  path: string,
  renderPage: (params: {
    workflowRunId?: string | undefined;
    search: ReturnType<typeof validateWorkflowRunsSearch>;
  }) => ReactElement,
): RenderResult & {
  queryClient: QueryClient;
  router: ReturnType<typeof createTestRouter>;
} {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createTestRouter(path, renderPage);
  const store = createStore();
  store.set(authStateAtom, authState);

  configureApiClient({baseUrl: 'https://api.example.test'});

  const result = render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>,
  );

  return Object.assign(result, {queryClient, router});
}
