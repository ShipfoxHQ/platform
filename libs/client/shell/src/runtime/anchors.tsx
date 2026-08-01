import {ShipfoxLoader} from '@shipfox/react-ui/loader';
import {Header, Text} from '@shipfox/react-ui/typography';
import {createRootRouteWithContext, createRoute, Outlet, redirect} from '@tanstack/react-router';
import {MainLayout} from '#components/main-layout.js';
import {NotFoundPage} from '#components/not-found-page.js';
import {SettingsNav} from '#components/settings-nav.js';
import type {NavTabEntry, SettingsSectionEntry} from '#contract.js';
import {useActiveWorkspace, useMaybeActiveWorkspace} from './active-workspace.js';
import {anchorPaths} from './anchor-paths.js';
import {rememberLastWorkspaceId} from './last-workspace.js';
import type {RouterContext} from './router-context.js';
import {
  WorkspaceLayoutErrorRoute,
  WorkspaceSetupPending,
  WorkspaceUnavailablePage,
} from './workspace-setup.js';

export {routePathForAnchor} from './anchor-paths.js';

export function buildAnchorSkeleton({
  navigation,
  settingsSections,
}: {
  navigation: readonly NavTabEntry[];
  settingsSections: readonly SettingsSectionEntry[];
}) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
    notFoundComponent: NotFoundPage,
  });
  const workspaceLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: anchorPaths.workspaceLayout,
    beforeLoad: async ({context, params, location}) => {
      const auth = context.auth;
      if (!auth || auth.isLoading || !context.queryClient) return;
      if (!auth.isAuthenticated)
        throw redirect({to: '/auth/login' as never, search: {redirect: location.href} as never});
      const workspace = auth.workspaces.find(
        (candidate) => candidate.slug === params.workspaceSlug,
      );
      if (!workspace) throw redirect({to: '/'});
      try {
        if (auth.user?.id) rememberLastWorkspaceId(auth.user.id, workspace.id);
      } catch {
        // Local storage is best effort.
      }
      if (!context.workspaceSetup)
        throw new Error('Client composition includes workspace routes but no workspaceSetup gate.');
      return await context.workspaceSetup({
        queryClient: context.queryClient,
        workspaceId: workspace.id,
        workspaceSlug: params.workspaceSlug,
        pathname: location.pathname,
      });
    },
    pendingComponent: () => (
      <div className="flex h-screen items-center justify-center">
        <ShipfoxLoader size={64} animation="circular" color="orange" background="dark" />
      </div>
    ),
    errorComponent: WorkspaceLayoutErrorRoute,
    component: () => {
      const setupState = workspaceLayout.useRouteContext() as {
        hideProjectNavigation?: boolean;
        unavailable?: boolean;
      };
      const workspace = useMaybeActiveWorkspace();
      return setupState.hideProjectNavigation === undefined ? (
        <WorkspaceSetupPending />
      ) : setupState.unavailable ? (
        <WorkspaceUnavailablePage workspaceName={workspace?.name} />
      ) : (
        <MainLayout
          navigation={navigation}
          hideProjectNavigation={setupState.hideProjectNavigation}
        />
      );
    },
  });
  const projectLayout = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/p/$projectSlug',
    beforeLoad: async ({context, params}) => {
      const auth = context.auth;
      if (!auth || auth.isLoading || !context.queryClient) return;
      const workspace = auth.workspaces.find(
        (candidate) => candidate.slug === params.workspaceSlug,
      );
      if (!workspace) throw redirect({to: '/'});
      if (!context.projectSlugResolver) {
        throw new Error('Client composition includes project routes but no project slug resolver.');
      }
      const projectId = await context.projectSlugResolver({
        queryClient: context.queryClient,
        workspaceId: workspace.id,
        projectSlug: params.projectSlug,
      });
      if (!projectId) {
        throw redirect({
          to: '/w/$workspaceSlug',
          params: {workspaceSlug: params.workspaceSlug},
        });
      }
    },
    component: Outlet,
  });
  const workspaceSettings = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/settings',
    component: () => {
      const workspace = useActiveWorkspace();
      return (
        <div className="flex w-full flex-col gap-24">
          <header className="flex flex-col gap-6">
            <Header variant="h2">Workspace settings</Header>
            <Text size="sm" className="text-foreground-neutral-muted">
              Configure {workspace.name}.
            </Text>
          </header>

          <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-32 max-[760px]:grid-cols-1">
            <SettingsNav entries={settingsSections} />
            <Outlet />
          </div>
        </div>
      );
    },
  });
  return {
    anchors: {root: rootRoute, workspaceLayout, projectLayout, workspaceSettings},
    rootRoute,
    workspaceLayout,
    projectLayout,
    workspaceSettings,
  };
}
