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
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {Provider as JotaiProvider, useSetAtom} from 'jotai';
import {type ReactElement, useEffect} from 'react';

export const INTEGRATIONS_TEST_WID = '11111111-1111-4111-8111-111111111111';

export interface TestWorkspace {
  id: string;
  name: string;
  slug: string;
  membershipId: string;
}

export function testWorkspace(overrides: Partial<TestWorkspace> = {}): TestWorkspace {
  return {id: INTEGRATIONS_TEST_WID, name: 'Acme', slug: 'acme', membershipId: 'm-1', ...overrides};
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function authState(workspaces: TestWorkspace[]): AuthState {
  return {
    status: 'authenticated',
    token: 'token',
    user: {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'user@example.com',
      emailVerifiedAt: new Date().toISOString(),
    },
    workspaces,
  };
}

interface RenderIntegrationsPageOptions {
  /** Initial history entry, may carry a query string. */
  path: string;
  /** Route template the element mounts at (e.g. /integrations/sentry/callback). */
  routePath: string;
  element: ReactElement;
  workspaces?: TestWorkspace[];
  /** Additional route templates registered with a stub component, for navigation targets. */
  extraRoutes?: string[];
  /** Seed auth as still-loading (the cold-load window) instead of authenticated. */
  loadingAuth?: boolean;
}

function AuthSeed({workspaces, loading}: {workspaces: TestWorkspace[]; loading?: boolean}) {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    setAuth(loading ? {status: 'loading'} : authState(workspaces));
  }, [setAuth, workspaces, loading]);

  return null;
}

export function renderIntegrationsPage(options: RenderIntegrationsPageOptions): RenderResult {
  const workspaces = options.workspaces ?? [testWorkspace()];
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  const rootRoute = createRootRoute({component: Outlet});
  const mainRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: options.routePath,
    component: () => options.element,
  });
  const extraRoutes = (options.extraRoutes ?? []).map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <div data-testid={`route:${path}`} />,
    }),
  );

  const router = createRouter({
    history: createMemoryHistory({initialEntries: [options.path]}),
    routeTree: rootRoute.addChildren([mainRoute, ...extraRoutes]),
  });

  configureApiClient({baseUrl: 'https://api.example.test'});

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthSeed workspaces={workspaces} loading={options.loadingAuth ?? false} />
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>,
  );
}
