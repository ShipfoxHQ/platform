import {QueryClient} from '@tanstack/react-query';
import {createMemoryHistory, createRouter, RouterProvider} from '@tanstack/react-router';
import {render} from '@testing-library/react';
import {createStore} from 'jotai';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import type {ClientFeature} from '#contract.js';
import {assembleRouteTree, type ResolveRouteImpl} from '#runtime/assemble-route-tree.js';
import {type AuthStateValue, authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots} from '#runtime/chrome-context.js';
import {type ClientAnalytics, ClientAnalyticsProvider} from '#runtime/client-analytics.js';
import {ShellProviderStack} from '#runtime/provider-stack.js';
import {navigationEntries, settingsEntries} from '#runtime/registries.js';
import type {WorkspaceSetupGate} from '#runtime/workspace-setup.js';

export async function renderComposedShell({
  auth: authOverride,
  features,
  initialPath,
  resolveImpl,
  chrome: chromeOverrides,
  workspaceSetup,
  clientAnalytics,
}: {
  auth?: AuthStateValue;
  features: readonly ClientFeature[];
  initialPath: string;
  resolveImpl: ResolveRouteImpl;
  chrome?: Partial<ChromeSlots>;
  workspaceSetup?: WorkspaceSetupGate;
  clientAnalytics?: ClientAnalytics;
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
  const auth: AuthStateValue =
    authOverride ??
    ({
      status: 'authenticated',
      workspaces: [
        {id: 'workspace', name: 'Workspace', slug: 'workspace', membershipId: 'membership'},
      ],
      isLoading: false,
      isAuthenticated: true,
      hasWorkspace: true,
    } satisfies AuthStateValue);
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
      workspaceSetup: workspaceSetup ?? (async () => ({hideProjectNavigation: false})),
      projectSlugResolver: chrome.projectSlugResolver,
    },
  });
  render(
    <ChromeProvider chrome={chrome}>
      <ClientAnalyticsProvider {...(clientAnalytics ? {analytics: clientAnalytics} : {})}>
        <ShellProviderStack
          features={features}
          queryClient={queryClient}
          store={store}
          auth={{effects: false}}
        >
          <RouterProvider router={router} />
        </ShellProviderStack>
      </ClientAnalyticsProvider>
    </ChromeProvider>,
  );
  return {router, queryClient, store};
}
