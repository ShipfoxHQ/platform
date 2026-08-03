import {configureApiClient} from '@shipfox/client-api';
import {AuthRuntime} from '@shipfox/client-shell/runtime';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {Provider as JotaiProvider} from 'jotai';
import {LogoutPage} from './logout-page.js';

function renderLogoutPage(path: string) {
  const rootRoute = createRootRoute({component: Outlet});
  const logoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/logout',
    component: LogoutPage,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/login',
    component: () => <h1>Login destination</h1>,
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => <h1>Workspace destination</h1>,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([logoutRoute, loginRoute, workspaceRoute]),
  });
  const queryClient = new QueryClient();

  render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthRuntime effects={false}>
          <RouterProvider router={router} />
        </AuthRuntime>
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

describe('LogoutPage', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('logs out before following a safe same-origin redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    renderLogoutPage('/auth/logout?redirect=%2Fw%2Facme');

    expect(await screen.findByRole('heading', {name: 'Workspace destination'})).toBeVisible();
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/auth/logout');
    expect(request.method).toBe('POST');
  });

  test('falls back to login without forwarding an invitation token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({fetchImpl});

    renderLogoutPage('/auth/logout?redirect=%2Finvitations%2Faccept%3Ftoken%3Dsf_i_raw-token');

    expect(await screen.findByRole('heading', {name: 'Login destination'})).toBeVisible();
  });
});
