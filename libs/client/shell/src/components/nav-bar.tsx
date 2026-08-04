import {Logo} from '@shipfox/react-ui/logo';
import {Link} from '@tanstack/react-router';
import {useActiveWorkspace} from '#runtime/active-workspace.js';
import {useChrome} from '#runtime/chrome-context.js';
import {UserMenu} from './user-menu.js';
import {WorkspaceCrumb} from './workspace-crumb.js';

export function NavBar({hideProjectNavigation = false}: {hideProjectNavigation?: boolean}) {
  const workspace = useActiveWorkspace();
  const {ProjectBreadcrumb} = useChrome();
  return (
    <header className="sticky top-0 z-30 h-56 px-row flex items-center gap-cluster bg-background-subtle-base border-b border-border-neutral-base shrink-0">
      <Link
        to="/"
        aria-label="Shipfox home"
        className="rounded-6 focus-visible:outline-none focus-visible:shadow-button-neutral-focus"
      >
        {hideProjectNavigation ? (
          <>
            <Logo variant="mark" alt="" className="sm:hidden" />
            <Logo variant="wordmark" alt="" className="hidden sm:block" />
          </>
        ) : (
          <Logo variant="wordmark" alt="" />
        )}
      </Link>
      <span className="h-20 w-px bg-border-neutral-base" aria-hidden="true" />
      <WorkspaceCrumb workspace={workspace} compact={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : (
        <>
          <span className="text-foreground-neutral-muted" aria-hidden="true">
            /
          </span>
          <ProjectBreadcrumb />
        </>
      )}
      <div className="flex-1" />
      <UserMenu />
    </header>
  );
}
