import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
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
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {createStore, Provider as JotaiProvider} from 'jotai';
import type {ReactElement} from 'react';
import {CreateProjectPage} from '#pages/create-project-page.js';
import {ProjectsHubPage} from '#pages/projects-hub-page.js';

// All test renders that exercise pages requiring `useActiveWorkspace()` mount
// under `/w/$workspaceSlug`. APIs still use the UUID below.
export const PROJECT_TEST_WID = '11111111-1111-4111-8111-111111111111';
export const PROJECT_TEST_WSLUG = 'acme';

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'user@example.com',
    emailVerifiedAt: new Date().toISOString(),
  },
  workspaces: [{id: PROJECT_TEST_WID, name: 'Acme', slug: PROJECT_TEST_WSLUG, membershipId: 'm-1'}],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createTestRouter(path: string, element: ReactElement) {
  const initialPath = path.split('?')[0] ?? path;
  const rootRoute = createRootRoute({component: Outlet});
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (initialPath === '/' ? element : <ProjectsHubPage />),
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => (initialPath === `/w/${PROJECT_TEST_WSLUG}` ? element : <ProjectsHubPage />),
  });
  const workspaceNewProjectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/projects/new',
    component: () =>
      initialPath === `/w/${PROJECT_TEST_WSLUG}/projects/new` ? element : <CreateProjectPage />,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/integrations',
    component: () => <div>Integrations gallery placeholder</div>,
  });
  const modelProviderSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agents',
    component: () => <div>Agent settings placeholder</div>,
  });
  const projectDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug',
    component: () => {
      const params = useParams({strict: false}) as {projectSlug?: string};
      if (initialPath === `/w/${PROJECT_TEST_WSLUG}/p/${params.projectSlug}`) {
        return element;
      }

      // The harness only needs to prove project-detail navigation landed on the
      // Runs surface, so it renders a minimal stand-in rather than depending on
      // @shipfox/client-workflows.
      return <h1>Runs</h1>;
    },
  });
  const projectWorkflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/workflows',
    component: () => {
      const params = useParams({strict: false}) as {projectSlug?: string};
      if (initialPath === `/w/${PROJECT_TEST_WSLUG}/p/${params.projectSlug}/workflows`) {
        return element;
      }

      return <h1>Workflows</h1>;
    },
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([
      indexRoute,
      workspaceRoute,
      workspaceNewProjectRoute,
      integrationsRoute,
      modelProviderSettingsRoute,
      projectDetailRoute,
      projectWorkflowsRoute,
    ]),
  });
}

export function renderProjectPage(path: string, element: ReactElement): RenderResult {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createTestRouter(path, element);
  const store = createStore();
  store.set(authStateAtom, authState);

  configureApiClient({baseUrl: 'https://api.example.test'});

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>,
  );
}
