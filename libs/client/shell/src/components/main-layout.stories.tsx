import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient} from '@tanstack/react-query';
import {
  type AnyRouter,
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore} from 'jotai';
import {useEffect, useMemo, useState} from 'react';
import {expect, waitFor, within} from 'storybook/test';
import {composeClientFeatures} from '#compose/compose-client-features.js';
import {defineClientFeature} from '#contract.js';
import {assembleRouteTree} from '#runtime/assemble-route-tree.js';
import {type AuthStateValue, authStateAtom} from '#runtime/auth.js';
import {ChromeProvider, type ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {ShellProviders} from '../testing/index.js';

const WORKSPACE = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Acme Workspace',
  slug: 'acme',
  membershipId: '10000000-0000-4000-8000-000000000001',
};

const AUTH: AuthStateValue = {
  status: 'authenticated',
  token: 'story-access-token',
  user: {id: '00000000-0000-4000-8000-00000000000a', email: 'demo@shipfox.dev'},
  workspaces: [WORKSPACE],
  isLoading: false,
  isAuthenticated: true,
  hasWorkspace: true,
};

const SHELL_STORY_FEATURE = defineClientFeature({
  id: 'acme.shell-story',
  routes: [
    {path: '/w/$workspaceSlug/overview', parent: 'workspaceLayout', impl: 'overview'},
    {path: '/w/$workspaceSlug/projects', parent: 'workspaceLayout', impl: 'projects'},
    {path: '/w/$workspaceSlug/runners', parent: 'workspaceLayout', impl: 'runners'},
  ],
  navigation: [
    {id: 'overview', label: 'Overview', to: '/w/$workspaceSlug/overview', scope: 'workspace'},
    {id: 'projects', label: 'Projects', to: '/w/$workspaceSlug/projects', scope: 'workspace'},
    {id: 'runners', label: 'Runners', to: '/w/$workspaceSlug/runners', scope: 'workspace'},
  ],
});

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
    nextStore.set(authStateAtom, AUTH);
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
  const [router, setRouter] = useState<AnyRouter | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const composition = composeClientFeatures([SHELL_STORY_FEATURE]);
      const routeTree = await assembleRouteTree(composition.routes, {
        layouts: composition.layouts,
        resolveImpl: () => defineRoute({staticData: {frame: 'content'}, component: OverviewPage}),
        navigation: composition.navigation,
        settingsSections: composition.settingsSections,
      });
      if (cancelled) return;
      setRouter(
        createRouter({
          routeTree,
          history: createMemoryHistory({initialEntries: ['/w/acme/overview']}),
          context: {
            auth: AUTH,
            queryClient,
            workspaceSetup: async () => ({hideProjectNavigation}),
            projectSlugResolver: chrome.projectSlugResolver,
          },
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient, chrome, hideProjectNavigation]);

  // The provider stack mounts on the first render, before the async router
  // assembly resolves, so its ThemeProvider commits together with the preview
  // decorator's ThemeProvider. React flushes child effects before the parent's
  // on mount, so the preview's theme (the Argos mode) is applied last and stays
  // authoritative; if the stack mounted only after the router resolved, its
  // system-default ThemeProvider would clobber the mode's dark class and every
  // snapshot would render light. The router content is gated below instead.
  return (
    <ChromeProvider chrome={chrome}>
      <ShellProviders features={[SHELL_STORY_FEATURE]} queryClient={queryClient} store={store}>
        {router ? <RouterProvider router={router} /> : null}
      </ShellProviders>
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

export const Playground: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const main = await canvas.findByRole('main');
    // The Argos dark mode must stay authoritative on the preview document; the
    // shell provider stack's system-default ThemeProvider would otherwise leave
    // snapshots light (see the MainLayoutStory mount-order comment above).
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    await waitFor(() => {
      const banner = canvas.getByText('Session banner slot');
      const strip = banner.parentElement;
      expect(strip).not.toBeNull();
      const expectedHeight = `calc(100dvh - ${96 + Math.round((strip as HTMLElement).getBoundingClientRect().height)}px)`;
      expect(main.style.getPropertyValue('--app-content-h')).toBe(expectedHeight);
    });
  },
};

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
