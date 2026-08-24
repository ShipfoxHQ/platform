import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate, Outlet, useLocation, useMatches} from '@tanstack/react-router';
import {type CSSProperties, useEffect, useMemo, useRef, useState} from 'react';
import type {NavTabEntry} from '#contract.js';
import {useMaybeActiveWorkspace} from '#runtime/active-workspace.js';
import {useAuthState} from '#runtime/auth.js';
import {useChrome} from '#runtime/chrome-context.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';
import type {RouteFrame} from '#runtime/route-frame.js';
import {parseWorkspaceProjectParams, useRouteParams} from '#runtime/route-inputs.js';
import {WorkspaceUnavailablePage} from '#runtime/workspace-setup.js';
import {FOCUSED_FRAME_CONTENT_CLASS_NAME} from './focused-frame.js';
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
  focused: `${FOCUSED_FRAME_CONTENT_CLASS_NAME} px-frame py-frame`,
};

/**
 * Minimum height of the reserved SessionBanner strip, in pixels. The layout
 * reserves this much for the slot and the app-content viewport arithmetic
 * starts from it; the rendered strip height is measured and feeds the
 * arithmetic so taller banners keep the content area consistent.
 */
const SESSION_BANNER_HEIGHT_PX = 40;

export function MainLayout({
  navigation,
  hideProjectNavigation = false,
}: {
  navigation: readonly NavTabEntry[];
  hideProjectNavigation?: boolean;
}) {
  const auth = useAuthState();
  const workspace = useMaybeActiveWorkspace();
  const location = useLocation();
  const {projectSlug} = useRouteParams(parseWorkspaceProjectParams);
  const matches = useMatches();
  const {SessionBanner} = useChrome();
  const sessionBannerStripRef = useRef<HTMLDivElement | null>(null);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [bannerHeightPx, setBannerHeightPx] = useState(() =>
    SessionBanner ? SESSION_BANNER_HEIGHT_PX : 0,
  );
  // Retry the banner only when the route or the slot identity changes; the key
  // stays referentially stable across the onError/onRecovered state toggles so
  // a persistently failing slot latches instead of being retried in a loop.
  const bannerRetryKey = useMemo(
    () => ({href: location.href, slot: SessionBanner}),
    [location.href, SessionBanner],
  );

  // Keep the app-content deduction aligned with the rendered strip height.
  useEffect(() => {
    if (!SessionBanner || bannerFailed) return;
    const strip = sessionBannerStripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBannerHeightPx(entry.contentRect.height);
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [SessionBanner, bannerFailed]);

  if (auth.isLoading) return <FullPageLoader />;
  if (!auth.isAuthenticated) {
    return (
      <Navigate to={'/auth/login' as never} search={{redirect: location.href} as never} replace />
    );
  }
  if (!workspace) return <WorkspaceUnavailablePage />;
  const frame = matches.reduce<RouteFrame>(
    (current, match) => match.staticData.frame ?? current,
    'content',
  );
  const reservedHeightPx = bannerFailed ? 0 : bannerHeightPx;
  const appContentHeight = hideProjectNavigation
    ? `calc(100dvh - ${56 + reservedHeightPx}px)`
    : `calc(100dvh - ${96 + reservedHeightPx}px)`;
  const isFullBleedFrame = frame === 'data';
  const mainClassName = isFullBleedFrame
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
    : 'flex-1 overflow-auto';
  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      {SessionBanner ? (
        <ReportErrorBoundary
          label="Failed to render session banner."
          retryKey={bannerRetryKey}
          onError={() => setBannerFailed(true)}
          onRecovered={() => setBannerFailed(false)}
        >
          <div
            ref={sessionBannerStripRef}
            className="flex shrink-0 items-center bg-background-subtle-base"
            style={{minHeight: SESSION_BANNER_HEIGHT_PX}}
          >
            <SessionBanner />
          </div>
        </ReportErrorBoundary>
      ) : undefined}
      <NavBar hideProjectNavigation={hideProjectNavigation} />
      {hideProjectNavigation ? undefined : (
        <NavTabs entries={navigation} scope={projectSlug ? 'project' : 'workspace'} />
      )}
      <main
        className={mainClassName}
        style={{'--app-content-h': appContentHeight} as CSSProperties}
      >
        <div className={frameClassNames[frame]}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
