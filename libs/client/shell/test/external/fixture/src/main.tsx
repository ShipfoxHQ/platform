import {
  ConfigErrorScreen,
  getWindowRuntimeConfig,
  loadConfig,
  setLoadedConfig,
} from '@shipfox/client-config';
import {
  authStateAtom,
  ChromeProvider,
  type AuthState,
  type AuthStateValue,
  mergeConfigShapes,
  type RouterContext,
  useAuthState,
} from '@shipfox/client-shell/runtime';
import {ShellProviders} from '@shipfox/client-shell/testing';
import {DropdownMenuItem} from '@shipfox/react-ui/dropdown-menu';
import {QueryClient} from '@tanstack/react-query';
import {RouterProvider} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {features} from './features';
import {router} from './shipfox-app.gen';

const authState: AuthState = {
  status: 'authenticated',
  workspaces: [
    {
      id: 'workspace',
      name: 'External workspace',
      slug: 'external-workspace',
      membershipId: 'membership',
    },
  ],
};

export const auth: AuthStateValue = {
  ...authState,
  isLoading: false,
  isAuthenticated: true,
  hasWorkspace: true,
  workspaces: authState.workspaces ?? [],
};

export const workspaceSetup: NonNullable<RouterContext['workspaceSetup']> = async () => ({
  hideProjectNavigation: false,
});

function FixtureProjectBreadcrumb() {
  return null;
}

async function projectSlugResolver() {
  return 'project';
}

function FixtureAccountMenuEntry() {
  const {isAuthenticated} = useAuthState();
  if (!isAuthenticated) return null;
  return (
    <DropdownMenuItem data-testid="external-account-menu-entry">
      External account action
    </DropdownMenuItem>
  );
}

export function ClientApp() {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
  );
  const [store] = useState(() => {
    const value = createStore();
    // Linked mode has two Jotai type paths; Vite dedupes them to this store at runtime.
    value.set(authStateAtom as never, authState);
    return value;
  });
  const config = loadConfig(mergeConfigShapes(features), {
    runtime: getWindowRuntimeConfig(),
    build: import.meta.env,
  });
  if (!config.ok) return <ConfigErrorScreen errors={config.errors} />;
  setLoadedConfig(config.config);

  return (
    <ChromeProvider
      chrome={{
        ProjectBreadcrumb: FixtureProjectBreadcrumb,
        projectSlugResolver,
        AccountMenuEntry: FixtureAccountMenuEntry,
      }}
    >
      <ShellProviders
        features={features}
        queryClient={queryClient}
        store={store}
        config={config.config}
      >
        <RouterProvider
          router={router}
          context={{auth, queryClient, workspaceSetup, projectSlugResolver}}
        />
      </ShellProviders>
    </ChromeProvider>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<ClientApp />);
