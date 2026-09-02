import {Button} from '@shipfox/react-ui/button';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Logo} from '@shipfox/react-ui/logo';
import {Link, useLocation, useMatches, useNavigate} from '@tanstack/react-router';
import {
  type ComponentType,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {NavTabEntry} from '#contract.js';
import {useMaybeActiveWorkspace} from '#runtime/active-workspace.js';
import {useAuthState} from '#runtime/auth.js';
import {useChrome} from '#runtime/chrome-context.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';
import type {RouteFrame} from '#runtime/route-frame.js';
import {WorkspaceUnavailablePage} from '#runtime/workspace-setup.js';
import {FOCUSED_FRAME_CONTENT_CLASS_NAME} from './focused-frame.js';
import {NavTabs} from './nav-tabs.js';
import {UserMenu} from './user-menu.js';

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

interface ApplicationFrameNavigation {
  ariaLabel: string;
  entries: readonly NavTabEntry[];
  params?: Record<string, unknown> | undefined;
  projectScoped?: boolean | undefined;
}

export function ApplicationFrame({
  children,
  compactLogo = false,
  context,
  navigation,
  requireWorkspace = false,
}: PropsWithChildren<{
  compactLogo?: boolean | undefined;
  context: ReactNode;
  navigation?: ApplicationFrameNavigation | undefined;
  requireWorkspace?: boolean | undefined;
}>) {
  const auth = useAuthState();
  const workspace = useMaybeActiveWorkspace();
  const location = useLocation();
  const matches = useMatches();
  const {SessionBanner} = useChrome();
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

  if (auth.isLoading) return <FullPageLoader />;
  if (!auth.isAuthenticated) {
    return <GuestRedirect href={location.href} />;
  }
  if (requireWorkspace && !workspace) return <WorkspaceUnavailablePage />;

  const frame = matches.reduce<RouteFrame>(
    (current, match) => match.staticData.frame ?? current,
    'content',
  );
  const reservedHeightPx = SessionBanner ? bannerHeightPx : 0;
  const chromeHeightPx = 56 + (navigation ? 40 : 0) + reservedHeightPx;
  const appContentHeight = `calc(100dvh - ${chromeHeightPx}px)`;
  const isFullBleedFrame = frame === 'data';
  const mainClassName = isFullBleedFrame
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
    : 'flex-1 overflow-auto';

  return (
    <div className="h-screen w-full flex flex-col bg-background-subtle-base">
      {SessionBanner ? (
        <SessionBannerStrip
          sessionBanner={SessionBanner}
          retryKey={bannerRetryKey}
          onHeightChange={setBannerHeightPx}
        />
      ) : undefined}
      <ApplicationHeader compactLogo={compactLogo} context={context} />
      {navigation ? (
        <NavTabs
          ariaLabel={navigation.ariaLabel}
          entries={navigation.entries}
          params={navigation.params}
          projectScoped={navigation.projectScoped}
        />
      ) : undefined}
      <main
        className={mainClassName}
        style={{'--app-content-h': appContentHeight} as CSSProperties}
      >
        <div className={frameClassNames[frame]}>{children}</div>
      </main>
    </div>
  );
}

function GuestRedirect({href}: {href: string}) {
  const navigate = useNavigate();
  const [search] = useState(() => ({redirect: href}));
  useEffect(() => {
    void navigate({to: '/auth/login' as never, search: search as never, replace: true});
  }, [navigate, search]);
  return null;
}

function SessionBannerStrip({
  sessionBanner,
  onHeightChange,
  retryKey,
}: {
  sessionBanner: ComponentType;
  onHeightChange: (heightPx: number) => void;
  retryKey: unknown;
}) {
  const SessionBanner = sessionBanner;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [bannerFailed, setBannerFailed] = useState(false);

  // Reset stale or failed measurements before paint when the slot state changes.
  useLayoutEffect(() => {
    onHeightChange(bannerFailed ? 0 : SESSION_BANNER_HEIGHT_PX);
  }, [bannerFailed, onHeightChange]);

  // The strip exists only after authentication succeeds, so observation starts
  // when the guarded browser chrome actually mounts.
  useEffect(() => {
    if (bannerFailed || typeof ResizeObserver === 'undefined') return;
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) onHeightChange(entry.contentRect.height);
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [bannerFailed, onHeightChange]);

  return (
    <ReportErrorBoundary
      label="Failed to render session banner."
      retryKey={retryKey}
      onError={() => setBannerFailed(true)}
      onRecovered={() => setBannerFailed(false)}
    >
      <div
        ref={stripRef}
        className="flex shrink-0 items-center bg-background-subtle-base"
        style={{minHeight: SESSION_BANNER_HEIGHT_PX}}
      >
        <SessionBanner />
      </div>
    </ReportErrorBoundary>
  );
}

function ApplicationHeader({compactLogo, context}: {compactLogo: boolean; context: ReactNode}) {
  return (
    <header className="sticky top-0 z-30 h-56 px-row flex items-center gap-cluster bg-background-subtle-base border-b border-border-neutral-base shrink-0">
      <Link
        to="/"
        aria-label="Shipfox home"
        className="shrink-0 rounded-6 focus-visible:outline-none focus-visible:shadow-button-neutral-focus"
      >
        {compactLogo ? (
          <>
            <Logo variant="mark" alt="" className="sm:hidden" />
            <Logo variant="wordmark" alt="" className="hidden sm:block" />
          </>
        ) : (
          <Logo variant="wordmark" alt="" />
        )}
      </Link>
      <span className="h-20 w-px shrink-0 bg-border-neutral-base" aria-hidden="true" />
      <div className="flex min-w-0 items-center gap-cluster overflow-hidden">{context}</div>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-cluster">
        <Button asChild variant="transparent" size="sm" className="text-foreground-neutral-subtle">
          <a
            href="https://shipfox.io/docs"
            target="_blank"
            rel="noreferrer noopener"
            aria-label="Docs (opens in new tab)"
          >
            Docs
          </a>
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}
