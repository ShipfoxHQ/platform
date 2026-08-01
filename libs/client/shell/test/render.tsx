import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory, createRouter, RouterProvider} from '@tanstack/react-router';
import {render} from '@testing-library/react';
import {createStore} from 'jotai';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import type {ClientFeature} from '#contract.js';
import {assembleRouteTree, type ResolveRouteImpl} from '#runtime/assemble-route-tree.js';
import {type AuthStateValue, authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots} from '#runtime/chrome-context.js';
import {ShellProviderStack} from '#runtime/provider-stack.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';

export async function renderComposedShell({
  features,
  initialPath,
  resolveImpl,
  chrome: chromeOverrides,
}: {
  features: readonly ClientFeature[];
  initialPath: string;
  resolveImpl: ResolveRouteImpl;
  chrome?: Partial<ChromeSlots>;
}): Promise<{
  router: unknown;
  queryClient: QueryClient;
  store: ReturnType<typeof createStore>;
}> {
  const composition = composeClientFeatures(features);
  const routeTree = await assembleRouteTree(composition.routes, {
    layouts: composition.layouts,
    resolveImpl,
    navigation: navigationEntries(features),
    settingsSections: settingsEntries(features),
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const store = createStore();
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
    projectSlugResolver: async () => 'project',
    ...chromeOverrides,
  };
  store.set(authStateAtom, auth);
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [initialPath]}),
    routeTree,
    context: {
      auth,
      queryClient,
      workspaceSetup: async () => ({hideProjectNavigation: false}),
      projectSlugResolver: chrome.projectSlugResolver,
    },
  });
  render(
    <ChromeProvider chrome={chrome}>
      <ShellProviderStack
        features={features}
        queryClient={queryClient}
        store={store}
        auth={{effects: false}}
      >
        <RouterProvider router={router} />
      </ShellProviderStack>
    </ChromeProvider>,
  );
  return {router, queryClient, store};
}
