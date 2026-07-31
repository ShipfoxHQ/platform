import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory, Outlet, RouterProvider} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {createStore} from 'jotai';
import {authStateAtom} from '#runtime/auth.js';
import {type AuthStateValue, ChromeProvider, type ChromeSlots} from '#runtime/index.js';
import {ShellProviderStack} from '#runtime/provider-stack.js';
import {router} from '#test/typecheck/shipfox-app.gen.js';

describe('generated composition router', () => {
  test('renders added and overridden routes', async () => {
    const auth: AuthStateValue = {
      status: 'authenticated',
      workspaces: [
        {id: 'workspace', name: 'Workspace', slug: 'workspace', membershipId: 'membership'},
      ],
      isLoading: false,
      isAuthenticated: true,
      hasWorkspace: true,
    };
    const chrome: ChromeSlots = {
      ProjectBreadcrumb: () => null,
      ProjectLayoutGuard: Outlet,
    };
    const queryClient = new QueryClient();
    const store = createStore();
    store.set(authStateAtom, auth);
    router.update({
      history: createMemoryHistory({initialEntries: ['/workspaces/workspace/insights']}),
      context: {
        auth,
        queryClient,
        workspaceSetup: async () => ({hideProjectNavigation: false}),
      },
    });

    render(
      <ChromeProvider chrome={chrome}>
        <ShellProviderStack
          features={[]}
          queryClient={queryClient}
          store={store}
          auth={{effects: false}}
        >
          <RouterProvider router={router} />
        </ShellProviderStack>
      </ChromeProvider>,
    );

    expect(await screen.findByText('Named route')).toBeVisible();

    await router.navigate({
      to: '/workspaces/$wid/projects/$pid/overview',
      params: {wid: 'workspace', pid: 'project'},
      search: {tab: 'overview'},
    });

    expect(await screen.findByText('Search route')).toBeVisible();
  });
});
