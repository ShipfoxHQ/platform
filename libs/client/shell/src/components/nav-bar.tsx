import {useActiveWorkspace} from '#runtime/active-workspace.js';
import {useChrome} from '#runtime/chrome-context.js';
import {WorkspaceCrumb} from './workspace-crumb.js';

export function NavBarContext({hideProjectNavigation = false}: {hideProjectNavigation?: boolean}) {
  const workspace = useActiveWorkspace();
  const {ProjectBreadcrumb, WorkspaceSetupIndicator} = useChrome();
  return (
    <>
      <WorkspaceCrumb workspace={workspace} compact={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : (
        <>
          <span className="text-foreground-neutral-muted" aria-hidden="true">
            /
          </span>
          <ProjectBreadcrumb />
          {WorkspaceSetupIndicator ? <WorkspaceSetupIndicator /> : undefined}
        </>
      )}
    </>
  );
}
