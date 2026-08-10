import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Outlet, useMatches} from '@tanstack/react-router';
import type {NavTabEntry} from '#contract.js';
import {useMaybeActiveWorkspace} from '#runtime/active-workspace.js';
import type {RouteFrame} from '#runtime/route-frame.js';
import {parseWorkspaceProjectParams, useRouteParams} from '#runtime/route-inputs.js';
import {NavBar} from './nav-bar.js';
import {NavTabs} from './nav-tabs.js';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    frame?: RouteFrame;
  }
}

const frameClassNames: Record<RouteFrame, string> = {
  content: 'mx-auto w-full max-w-[1120px] px-frame py-frame',
  data: 'flex min-h-0 w-full flex-1 flex-col px-frame py-frame',
  focused: 'mx-auto w-full max-w-[640px] px-frame py-frame',
};

export function MainLayout({
  navigation,
  hideProjectNavigation = false,
}: {
  navigation: readonly NavTabEntry[];
  hideProjectNavigation?: boolean;
}) {
  const workspace = useMaybeActiveWorkspace();
  const {projectSlug} = useRouteParams(parseWorkspaceProjectParams);
  const matches = useMatches();
  if (!workspace) return <FullPageLoader />;
  const frame = matches.reduce<RouteFrame>(
    (current, match) => match.staticData.frame ?? current,
    'content',
  );
  const appContentHeight = hideProjectNavigation
    ? '[--app-content-h:calc(100dvh_-_56px)]'
    : '[--app-content-h:calc(100dvh_-_96px)]';
  const isFullBleedFrame = frame === 'data';
  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      <NavBar hideProjectNavigation={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : (
        <NavTabs entries={navigation} scope={projectSlug ? 'project' : 'workspace'} />
      )}
      <main
        className={`${isFullBleedFrame ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'flex-1 overflow-auto'} ${appContentHeight}`}
      >
        <div className={frameClassNames[frame]}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
