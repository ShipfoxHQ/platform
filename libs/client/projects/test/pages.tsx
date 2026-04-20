import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
import {Toaster} from '@shipfox/react-ui';
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
import {Provider as JotaiProvider, useSetAtom} from 'jotai';
import {type ReactElement, useEffect} from 'react';
import {CreateProjectPage} from '#pages/create-project-page.js';
import {ProjectDetailPage} from '#pages/project-detail-page.js';
import {ProjectsHubPage} from '#pages/projects-hub-page.js';

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'user@example.com',
    name: null,
    email_verified_at: new Date().toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  workspaces: [{id: '11111111-1111-4111-8111-111111111111', name: 'Acme', membershipId: 'm-1'}],
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
  const newProjectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/new',
    component: () => (initialPath === '/projects/new' ? element : <CreateProjectPage />),
  });
  const projectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/projects/$projectId',
    component: () => {
      const params = useParams({strict: false}) as {projectId?: string};
      if (initialPath.startsWith('/projects/') && initialPath !== '/projects/new') {
        return element;
      }

      return <ProjectDetailPage projectId={params.projectId ?? 'p-1'} />;
    },
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([indexRoute, newProjectRoute, projectRoute]),
  });
}

function AuthSeed() {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    setAuth(authState);
  }, [setAuth]);

  return null;
}

export function renderProjectPage(path: string, element: ReactElement): RenderResult {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createTestRouter(path, element);

  configureApiClient({baseUrl: 'https://api.example.test'});

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthSeed />
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>,
  );
}
