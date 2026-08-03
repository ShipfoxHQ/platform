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

export const WORKSPACE_SETTINGS_TEST_WID = '11111111-1111-4111-8111-111111111111';

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'user@example.com',
    emailVerifiedAt: new Date().toISOString(),
  },
  workspaces: [{id: WORKSPACE_SETTINGS_TEST_WID, name: 'Acme', slug: 'acme', membershipId: 'm-1'}],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createTestRouter(path: string, element: ReactElement) {
  const rootRoute = createRootRoute({component: Outlet});
  const runnersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/runners',
    component: () => element,
  });
  const provisionersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/provisioners',
    component: () => element,
  });
  const modelProvidersRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agents',
    component: () => element,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/integrations',
    component: () => element,
  });
  const generalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/general',
    component: () => element,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([
      runnersRoute,
      provisionersRoute,
      modelProvidersRoute,
      integrationsRoute,
      generalRoute,
    ]),
  });
}

function AuthSeed() {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    setAuth(authState);
  }, [setAuth]);

  return null;
}

export function renderWorkspaceSettingsPage(path: string, element: ReactElement): RenderResult {
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
