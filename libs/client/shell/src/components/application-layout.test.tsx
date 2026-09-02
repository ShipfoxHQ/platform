import {DropdownMenuItem} from '@shipfox/react-ui/dropdown-menu';
import type {AnyRouter} from '@tanstack/react-router';
import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import {atom, useAtomValue} from 'jotai';
import type {ComponentType} from 'react';
import {defineClientFeature} from '#contract.js';
import {type AuthStateValue, authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots, useChrome} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {useLayoutNavigation} from '#runtime/layout-navigation.js';
import {renderComposedShell} from '#test/render.js';
import {ApplicationLayout} from './application-layout.js';

const ROOT_AUTH: AuthStateValue = {
  status: 'authenticated',
  user: {id: 'user', email: 'root@example.com'},
  workspaces: [],
  isLoading: false,
  isAuthenticated: true,
  hasWorkspace: false,
};

const LOADING_AUTH: AuthStateValue = {
  status: 'loading',
  workspaces: [],
  isLoading: true,
  isAuthenticated: false,
  hasWorkspace: false,
};

const GUEST_AUTH: AuthStateValue = {
  status: 'guest',
  workspaces: [],
  isLoading: false,
  isAuthenticated: false,
  hasWorkspace: false,
};

const adminFeature = defineClientFeature({
  id: 'acme.admin',
  layouts: [{id: 'acme.admin', path: '/admin', parent: 'root', impl: 'layout'}],
  routes: [
    {path: '/admin/overview', parent: 'acme.admin', impl: 'overview'},
    {path: '/admin/overview/details', parent: 'acme.admin', impl: 'overview-details'},
    {path: '/admin/users', parent: 'acme.admin', impl: 'users'},
    {path: '/admin/users/$userId', parent: 'acme.admin', impl: 'user'},
  ],
  navigation: [
    {
      id: 'admin.overview',
      scope: 'layout',
      layout: 'acme.admin',
      label: 'Overview',
      to: '/admin/overview',
      exact: true,
      order: 100,
    },
    {
      id: 'admin.users',
      scope: 'layout',
      layout: 'acme.admin',
      label: 'Users',
      to: '/admin/users',
      minimumRole: 'opaque-root-role',
      order: 200,
    },
  ],
});

const emptyAdminFeature = defineClientFeature({
  id: 'acme.empty-admin',
  layouts: [{id: 'acme.empty-admin', path: '/empty-admin', parent: 'root', impl: 'empty-layout'}],
  routes: [{path: '/empty-admin/overview', parent: 'acme.empty-admin', impl: 'empty-overview'}],
});

const authFeature = defineClientFeature({
  id: 'acme.auth',
  routes: [{path: '/auth/login', parent: 'root', impl: 'login'}],
});

const tenantAdminFeature = defineClientFeature({
  id: 'acme.tenant-admin',
  layouts: [
    {
      id: 'acme.tenant-admin',
      path: '/tenant/$tenantSlug/admin',
      parent: 'root',
      impl: 'tenant-layout',
    },
  ],
  routes: [
    {
      path: '/tenant/$tenantSlug/admin/overview',
      parent: 'acme.tenant-admin',
      impl: 'tenant-overview',
    },
  ],
  navigation: [
    {
      id: 'tenant-admin.overview',
      scope: 'layout',
      layout: 'acme.tenant-admin',
      label: 'Tenant overview',
      to: '/tenant/$tenantSlug/admin/overview',
    },
  ],
});

function AdminLayout() {
  const entries = useLayoutNavigation('acme.admin');
  return (
    <ApplicationLayout
      context={
        <>
          <span>Administration</span>
          <span>Instance administrator</span>
        </>
      }
      navigation={{ariaLabel: 'Administration sections', entries}}
    />
  );
}

function EmptyAdminLayout() {
  const entries = useLayoutNavigation('acme.empty-admin');
  return (
    <ApplicationLayout
      context={<span>Empty administration</span>}
      navigation={{ariaLabel: 'Empty administration sections', entries}}
    />
  );
}

function TenantAdminLayout() {
  const entries = useLayoutNavigation('acme.tenant-admin');
  return (
    <ApplicationLayout
      context={<span>Tenant administration</span>}
      navigation={{ariaLabel: 'Tenant administration sections', entries}}
    />
  );
}

function AdminLayoutWithChildren() {
  const entries = useLayoutNavigation('acme.admin');
  return (
    <ApplicationLayout
      context={<span>Administration</span>}
      navigation={{ariaLabel: 'Administration sections', entries}}
    >
      <div>Inline administration content</div>
    </ApplicationLayout>
  );
}

function routeHeading(specifier: string) {
  const labels: Record<string, string> = {
    overview: 'Overview page',
    'overview-details': 'Overview details',
    users: 'Users page',
    user: 'User page',
    'empty-overview': 'Empty overview',
    'tenant-overview': 'Tenant overview page',
  };
  return labels[specifier] ?? specifier;
}

function renderAdmin({
  auth = ROOT_AUTH,
  chrome,
  frame = 'content',
  layoutComponent,
  path = '/admin/overview',
}: {
  auth?: AuthStateValue;
  chrome?: Partial<ChromeSlots>;
  frame?: 'content' | 'data' | 'focused';
  layoutComponent?: ComponentType;
  path?: string;
} = {}) {
  const feature = path.startsWith('/empty-admin') ? emptyAdminFeature : adminFeature;
  return renderComposedShell({
    auth,
    features: [feature, authFeature],
    initialPath: path,
    ...(chrome ? {chrome} : {}),
    resolveImpl: (specifier) => {
      if (specifier === 'layout') {
        return defineRoute({
          staticData: {frame: 'content'},
          component: layoutComponent ?? AdminLayout,
        });
      }
      if (specifier === 'empty-layout') {
        return defineRoute({staticData: {frame: 'content'}, component: EmptyAdminLayout});
      }
      if (specifier === 'login') {
        return defineRoute({
          staticData: {frame: 'content'},
          component: () => <h1>Login page</h1>,
        });
      }
      return defineRoute({
        staticData: {frame},
        component: () => <h1>{routeHeading(specifier)}</h1>,
      });
    },
  });
}

function renderTenantAdmin() {
  return renderComposedShell({
    auth: ROOT_AUTH,
    features: [tenantAdminFeature],
    initialPath: '/tenant/acme/admin/overview',
    resolveImpl: (specifier) =>
      defineRoute({
        staticData: {frame: 'content'},
        component:
          specifier === 'tenant-layout' ? TenantAdminLayout : () => <h1>Tenant overview page</h1>,
      }),
  });
}

describe('ApplicationLayout', () => {
  test('renders standard chrome and opaque layout navigation without a workspace', async () => {
    await renderAdmin();

    expect(await screen.findByRole('heading', {name: 'Overview page'})).toBeVisible();
    expect(screen.getByText('Administration')).toBeVisible();
    expect(screen.getByText('Instance administrator')).toBeVisible();
    expect(screen.getByRole('link', {name: 'Shipfox home'})).toBeVisible();
    const docsLink = screen.getByRole('link', {name: 'Docs (opens in new tab)'});
    expect(docsLink).toHaveAttribute('href', 'https://shipfox.io/docs');
    expect(docsLink).toHaveAttribute('target', '_blank');
    expect(docsLink).toHaveAttribute('rel', 'noreferrer noopener');
    const navigation = screen.getByRole('tablist', {name: 'Administration sections'});
    expect(
      within(navigation)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Overview', 'Users']);
    expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
  });

  test('keeps account controls reachable when header context is long', async () => {
    await renderAdmin();

    const context = (await screen.findByText('Administration')).parentElement;
    expect(context).toHaveClass('min-w-0', 'overflow-hidden');
    expect(screen.getByRole('link', {name: 'Docs (opens in new tab)'}).parentElement).toHaveClass(
      'shrink-0',
    );
    expect(screen.getByRole('button', {name: 'User menu'})).toBeVisible();
  });

  test('resolves layout navigation parameters from a dynamic root route', async () => {
    await renderTenantAdmin();

    expect(await screen.findByRole('tab', {name: 'Tenant overview'})).toHaveAttribute(
      'href',
      '/tenant/acme/admin/overview',
    );
  });

  test.each([
    ['/admin/overview/details', 'Overview', false],
    ['/admin/users/user-1', 'Users', true],
  ])('uses exact matching for %s', async (path, label, selected) => {
    await renderAdmin({path});

    const tab = await screen.findByRole('tab', {name: label});
    expect(tab).toHaveAttribute('aria-selected', String(selected));
  });

  test('reserves an empty navigation strip', async () => {
    await renderAdmin({path: '/empty-admin/overview'});

    expect(await screen.findByRole('heading', {name: 'Empty overview'})).toBeVisible();
    const navigation = screen.getByRole('tablist', {name: 'Empty administration sections'});
    expect(navigation).toBeEmptyDOMElement();
    expect(navigation).toHaveClass(
      'h-40',
      'overflow-x-auto',
      'whitespace-nowrap',
      '[scrollbar-width:none]',
      '[&::-webkit-scrollbar]:hidden',
    );
  });

  test('keeps overflowing navigation usable at a 375px viewport width', async () => {
    await renderAdmin();

    const navigation = await screen.findByRole('tablist', {name: 'Administration sections'});
    Object.defineProperties(navigation, {
      clientWidth: {configurable: true, value: 375},
      scrollWidth: {configurable: true, value: 640},
    });

    expect(navigation.scrollWidth).toBeGreaterThan(navigation.clientWidth);
    expect(navigation).toHaveClass(
      'overflow-x-auto',
      'whitespace-nowrap',
      '[scrollbar-width:none]',
      '[&::-webkit-scrollbar]:hidden',
    );
    for (const tab of within(navigation).getAllByRole('tab')) {
      expect(tab).toHaveClass('shrink-0', 'whitespace-nowrap');
    }
  });

  test('uses the shared account entry, theme controls, and logout action', async () => {
    function AccountMenuEntry() {
      return <DropdownMenuItem>Root account action</DropdownMenuItem>;
    }
    await renderAdmin({chrome: {AccountMenuEntry}});

    fireEvent.pointerDown(await screen.findByRole('button', {name: 'User menu'}));

    expect(await screen.findByRole('menuitem', {name: 'Root account action'})).toBeVisible();
    expect(screen.getByText('root@example.com')).toBeVisible();
    expect(screen.getByText('Theme')).toBeVisible();
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Light',
      'Dark',
      'System',
    ]);
    expect(screen.getByRole('menuitem', {name: 'Logout'})).toHaveAttribute('href', '/auth/logout');
  });

  test('updates content height when the shared session banner changes height', async () => {
    let resize: ResizeObserverCallback | undefined;
    class ResizeObserverProbe {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(): void {
        // The test invokes the captured callback directly.
      }
      unobserve(): void {
        // The test invokes the captured callback directly.
      }
      disconnect(): void {
        // The test invokes the captured callback directly.
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverProbe);

    try {
      await renderAdmin({chrome: {SessionBanner: () => <div>Root session banner</div>}});

      const main = await screen.findByRole('main');
      expect(main).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
      act(() => {
        resize?.([{contentRect: {height: 72}} as ResizeObserverEntry], {} as ResizeObserver);
      });
      expect(main).toHaveStyle('--app-content-h: calc(100dvh - 168px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('keeps the 40px fallback when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined);

    try {
      await renderAdmin({chrome: {SessionBanner: () => <div>Root session banner</div>}});

      expect(await screen.findByText('Root session banner')).toBeVisible();
      expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('installs banner measurement after authentication finishes loading', async () => {
    let resize: ResizeObserverCallback | undefined;
    class ResizeObserverProbe {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(): void {
        // The test only needs to confirm observation starts after authentication.
      }
      unobserve(): void {
        // The test only needs to confirm observation starts after authentication.
      }
      disconnect(): void {
        // The test only needs to confirm observation starts after authentication.
      }
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverProbe);

    try {
      const {store} = await renderAdmin({
        auth: LOADING_AUTH,
        chrome: {SessionBanner: () => <div>Root session banner</div>},
      });

      expect(await screen.findByRole('status', {name: 'Loading'})).toBeVisible();
      expect(screen.queryByText('Administration')).not.toBeInTheDocument();

      act(() => store.set(authStateAtom, ROOT_AUTH));

      expect(await screen.findByText('Administration')).toBeVisible();
      await waitFor(() => expect(resize).toBeTypeOf('function'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('contains and retries a failing session banner when the route changes', async () => {
    const failure = new Error('Root session banner failed');
    const reportErrorSpy = vi.fn();
    const bannerFailedAtom = atom(true);
    vi.stubGlobal('reportError', reportErrorSpy);
    function RecoverableSessionBanner() {
      if (useAtomValue(bannerFailedAtom)) throw failure;
      return <div>Recovered root session banner</div>;
    }

    try {
      const {router, store} = await renderAdmin({
        chrome: {SessionBanner: RecoverableSessionBanner},
      });

      expect(await screen.findByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: failure,
          message: 'Failed to render session banner.',
        }),
      );

      store.set(bannerFailedAtom, false);
      await (router as AnyRouter).navigate({to: '/admin/users' as never});

      expect(await screen.findByText('Recovered root session banner')).toBeVisible();
      expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('measures a failed banner again after its slot is removed and re-added', async () => {
    const failure = new Error('Root session banner failed');
    const reportErrorSpy = vi.fn();
    const bannerFailedAtom = atom(true);
    vi.stubGlobal('reportError', reportErrorSpy);
    function RecoverableSessionBanner() {
      if (useAtomValue(bannerFailedAtom)) throw failure;
      return <div>Recovered root session banner</div>;
    }
    const bannerSlotAtom = atom<{slot?: ComponentType}>({slot: RecoverableSessionBanner});
    function DynamicChromeAdminLayout() {
      const chrome = useChrome();
      const {slot} = useAtomValue(bannerSlotAtom);
      return (
        <ChromeProvider chrome={slot ? {...chrome, SessionBanner: slot} : chrome}>
          <AdminLayout />
        </ChromeProvider>
      );
    }

    try {
      const {store} = await renderAdmin({layoutComponent: DynamicChromeAdminLayout});

      expect(await screen.findByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
      act(() => {
        store.set(bannerSlotAtom, {});
        store.set(bannerFailedAtom, false);
      });
      act(() => store.set(bannerSlotAtom, {slot: RecoverableSessionBanner}));

      expect(await screen.findByText('Recovered root session banner')).toBeVisible();
      expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('redirects guests to login with the original root route', async () => {
    const {router} = await renderAdmin({auth: GUEST_AUTH});

    expect(await screen.findByRole('heading', {name: 'Login page'})).toBeVisible();
    await waitFor(() =>
      expect((router as AnyRouter).state.location.href).toBe(
        '/auth/login?redirect=%2Fadmin%2Foverview',
      ),
    );
  });

  test('renders supplied children instead of the nested route outlet', async () => {
    await renderAdmin({layoutComponent: AdminLayoutWithChildren});

    expect(await screen.findByText('Inline administration content')).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Overview page'})).not.toBeInTheDocument();
  });

  test.each([
    ['content', 'overflow-auto', 'max-w-[1120px]'],
    ['data', 'overflow-hidden', 'flex-1'],
    ['focused', 'overflow-auto', 'max-w-[640px]'],
  ] as const)('uses the deepest %s route frame', async (frame, mainClass, frameClass) => {
    await renderAdmin({frame});

    const main = await screen.findByRole('main');
    expect(main).toHaveClass(mainClass);
    expect(main.firstElementChild).toHaveClass(frameClass);
  });
});
