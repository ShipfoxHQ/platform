import {TooltipProvider} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useMemo} from 'react';
import type {NavTabEntry} from '#contract.js';
import {authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots} from '#runtime/chrome-context.js';
import type {RouterContext} from '#runtime/router-context.js';
import {MainLayout} from './main-layout.js';

const WORKSPACE = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Acme Workspace',
  slug: 'acme',
  membershipId: '10000000-0000-4000-8000-000000000001',
};

const NAVIGATION: NavTabEntry[] = [
  {id: 'overview', label: 'Overview', to: '/w/$workspaceSlug/overview', scope: 'workspace'},
  {id: 'projects', label: 'Projects', to: '/w/$workspaceSlug/projects', scope: 'workspace'},
  {id: 'runners', label: 'Runners', to: '/w/$workspaceSlug/runners', scope: 'workspace'},
];

/** Generic filler for the session-banner slot; impersonation UI never ships here. */
function DemoSessionBanner() {
  return (
    <div className="flex h-full items-center justify-center gap-cluster bg-background-neutral-base px-row text-xs font-medium text-foreground-neutral-base">
      <span className="size-8 rounded-full bg-background-highlight-base" aria-hidden="true" />
      Session banner slot
    </div>
  );
}

function OverviewPage() {
  return (
    <div className="flex flex-col gap-cluster">
      <Text size="md" className="text-foreground-neutral-base">
        Overview
      </Text>
      <Text size="sm" className="text-foreground-neutral-muted">
        Workspace content rendered inside the shell frame below the navigation chrome.
      </Text>
    </div>
  );
}

function MainLayoutStory({
  withSessionBanner,
  hideProjectNavigation,
}: {
  withSessionBanner: boolean;
  hideProjectNavigation: boolean;
}) {
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, {
      status: 'authenticated',
      token: 'story-access-token',
      user: {id: '00000000-0000-4000-8000-00000000000a', email: 'demo@shipfox.dev'},
      workspaces: [WORKSPACE],
    });
    return nextStore;
  }, []);
  const chrome = useMemo<ChromeSlots>(
    () => ({
      ProjectBreadcrumb: () => null,
      projectSlugResolver: async () => 'project',
      ...(withSessionBanner ? {SessionBanner: DemoSessionBanner} : {}),
    }),
    [withSessionBanner],
  );
  const router = useMemo(() => {
    const rootRoute = createRootRouteWithContext<RouterContext>()({component: Outlet});
    const workspaceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug',
      component: () => (
        <MainLayout navigation={NAVIGATION} hideProjectNavigation={hideProjectNavigation} />
      ),
    });
    const overviewRoute = createRoute({
      getParentRoute: () => workspaceRoute,
      path: '/overview',
      component: OverviewPage,
    });
    const projectsRoute = createRoute({
      getParentRoute: () => workspaceRoute,
      path: '/projects',
      component: OverviewPage,
    });
    const runnersRoute = createRoute({
      getParentRoute: () => workspaceRoute,
      path: '/runners',
      component: OverviewPage,
    });
    const routeTree = rootRoute.addChildren([
      workspaceRoute.addChildren([overviewRoute, projectsRoute, runnersRoute]),
    ]);
    return createRouter({
      routeTree,
      history: createMemoryHistory({initialEntries: ['/w/acme/overview']}),
      context: {
        auth: {
          status: 'authenticated',
          token: 'story-access-token',
          user: {id: '00000000-0000-4000-8000-00000000000a', email: 'demo@shipfox.dev'},
          workspaces: [WORKSPACE],
          isLoading: false,
          isAuthenticated: true,
          hasWorkspace: true,
        },
        queryClient,
        workspaceSetup: async () => ({hideProjectNavigation}),
        projectSlugResolver: chrome.projectSlugResolver,
      },
    });
  }, [queryClient, chrome, hideProjectNavigation]);

  return (
    <ChromeProvider chrome={chrome}>
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </JotaiProvider>
      </QueryClientProvider>
    </ChromeProvider>
  );
}

const meta = {
  title: 'Shell/MainLayout',
  component: MainLayoutStory,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    withSessionBanner: true,
    hideProjectNavigation: false,
  },
} satisfies Meta<typeof MainLayoutStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithoutBanner: Story = {
  args: {
    withSessionBanner: false,
  },
};

export const HideProjectNavigation: Story = {
  args: {
    hideProjectNavigation: true,
  },
};
