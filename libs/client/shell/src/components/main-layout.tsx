import {Outlet} from '@tanstack/react-router';
import type {NavTabEntry} from '#contract.js';
import {parseWorkspaceProjectParams, useRouteParams} from '#runtime/route-inputs.js';
import {ApplicationFrame} from './application-frame.js';
import {NavBarContext} from './nav-bar.js';

export function MainLayout({
  navigation,
  hideProjectNavigation = false,
}: {
  navigation: readonly NavTabEntry[];
  hideProjectNavigation?: boolean;
}) {
  const params = useRouteParams(parseWorkspaceProjectParams);
  const {projectSlug} = params;
  const scope = projectSlug ? 'project' : 'workspace';
  const entries = navigation.filter((entry) => entry.scope === scope);

  return (
    <ApplicationFrame
      compactLogo={hideProjectNavigation}
      context={<NavBarContext hideProjectNavigation={hideProjectNavigation} />}
      navigation={
        hideProjectNavigation
          ? undefined
          : {
              ariaLabel: `${projectSlug ? 'Project' : 'Workspace'} sections`,
              entries,
              params,
              projectScoped: !!projectSlug,
            }
      }
      requireWorkspace
    >
      <Outlet />
    </ApplicationFrame>
  );
}
