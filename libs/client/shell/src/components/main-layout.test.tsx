import type {AnyRouter} from '@tanstack/react-router';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {atom, useAtomValue} from 'jotai';
import {defineClientFeature} from '#contract.js';
import type {ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {renderComposedShell} from '#test/render.js';

function overviewFeature() {
  return defineClientFeature({
    id: 'acme.overview',
    routes: [
      {path: '/w/$workspaceSlug/overview', parent: 'workspaceLayout', impl: 'overview'},
      {path: '/w/$workspaceSlug/projects', parent: 'workspaceLayout', impl: 'projects'},
      {
        path: '/w/$workspaceSlug/p/$projectSlug/runs',
        parent: 'projectLayout',
        impl: 'runs',
      },
      {
        path: '/w/$workspaceSlug/p/$projectSlug/activity',
        parent: 'projectLayout',
        impl: 'activity',
      },
    ],
    navigation: [
      {
        id: 'overview',
        scope: 'workspace',
        label: 'Overview',
        to: '/w/$workspaceSlug/overview',
      },
      {
        id: 'projects',
        scope: 'workspace',
        label: 'Projects',
        to: '/w/$workspaceSlug/projects',
      },
      {
        id: 'runs',
        scope: 'project',
        label: 'Runs',
        to: '/w/$workspaceSlug/p/$projectSlug/runs',
      },
      {
        id: 'activity',
        scope: 'project',
        label: 'Activity',
        to: '/w/$workspaceSlug/p/$projectSlug/activity',
      },
    ],
  });
}

function renderMainLayout(
  chrome: Partial<ChromeSlots> = {},
  hideProjectNavigation = false,
  initialPath = '/w/workspace/overview',
) {
  return renderComposedShell({
    features: [overviewFeature()],
    initialPath,
    resolveImpl: (specifier) =>
      defineRoute({
        staticData: {frame: 'content'},
        component: () => <h1>{specifier}</h1>,
      }),
    chrome,
    workspaceSetup: async () => ({hideProjectNavigation}),
  });
}

describe('MainLayout navigation', () => {
  test.each([
    {
      initialPath: '/w/workspace/overview',
      labels: ['Overview', 'Projects'],
      targetLabel: 'Projects',
      targetPath: '/w/workspace/projects',
    },
    {
      initialPath: '/w/workspace/p/project/runs',
      labels: ['Runs', 'Activity'],
      targetLabel: 'Activity',
      targetPath: '/w/workspace/p/project/activity',
    },
  ])('filters and resolves navigation at $initialPath', async ({
    initialPath,
    labels,
    targetLabel,
    targetPath,
  }) => {
    const {router} = await renderMainLayout({}, false, initialPath);

    const navigation = await screen.findByRole('tablist');
    expect(
      within(navigation)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(labels);
    const target = within(navigation).getByRole('tab', {name: targetLabel});
    expect(target).toHaveAttribute('href', targetPath);

    fireEvent.click(target);

    await waitFor(() => expect((router as AnyRouter).state.location.pathname).toBe(targetPath));
  });
});

describe('MainLayout session banner', () => {
  test('renders no banner strip when the slot is absent', async () => {
    await renderMainLayout();

    expect(screen.queryByText('Session banner')).not.toBeInTheDocument();
    expect(await screen.findByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
  });

  test('renders a composed session banner above the navigation bar', async () => {
    await renderMainLayout({SessionBanner: () => <div>Session banner</div>});

    const banner = await screen.findByText('Session banner');
    expect(banner).toBeVisible();
    expect(
      banner.compareDocumentPosition(await screen.findByRole('banner')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
  });

  test.each([
    ['project navigation', false, false, 'calc(100dvh - 96px)'],
    ['project navigation and banner', true, false, 'calc(100dvh - 136px)'],
    ['hidden project navigation', false, true, 'calc(100dvh - 56px)'],
    ['hidden project navigation and banner', true, true, 'calc(100dvh - 96px)'],
  ])('keeps the app-content viewport arithmetic consistent with %s', async (_, withBanner, hideProjectNavigation, expectedAppContentHeight) => {
    await renderMainLayout(
      withBanner ? {SessionBanner: () => <div>Session banner</div>} : {},
      hideProjectNavigation,
    );

    expect(await screen.findByRole('main')).toHaveStyle(
      `--app-content-h: ${expectedAppContentHeight}`,
    );
  });

  test('contains a failing session banner without unmounting the shell', async () => {
    const failure = new Error('Session banner failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    const FailingSessionBanner = () => {
      throw failure;
    };

    try {
      await renderMainLayout({SessionBanner: FailingSessionBanner});

      expect(screen.queryByText('Session banner')).not.toBeInTheDocument();
      expect(await screen.findByRole('banner')).toBeVisible();
      // The reserved strip collapses with the failure, so the deduction reverts
      // to the no-banner baseline instead of leaving an empty 40px hole.
      expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');
      expect(reportErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cause: failure,
          message: 'Failed to render session banner.',
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('recovers a transiently failing banner on the next layout render', async () => {
    const failure = new Error('Session banner failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    const bannerFailedAtom = atom(true);
    const SessionBannerWithRecoverableRead = () => {
      if (useAtomValue(bannerFailedAtom)) throw failure;
      return <div>Recovered session banner</div>;
    };

    try {
      const {router, store} = await renderMainLayout({
        SessionBanner: SessionBannerWithRecoverableRead,
      });

      expect(screen.queryByText('Recovered session banner')).not.toBeInTheDocument();
      expect(await screen.findByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 96px)');

      // The underlying read recovers and the next layout render makes the
      // boundary retry the slot, so the transient failure clears without a
      // reload.
      store.set(bannerFailedAtom, false);
      await (router as AnyRouter).navigate({to: '/w/workspace/projects' as never});
      await (router as AnyRouter).navigate({to: '/w/workspace/overview' as never});

      expect(await screen.findByText('Recovered session banner')).toBeVisible();
      expect(screen.getByRole('main')).toHaveStyle('--app-content-h: calc(100dvh - 136px)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('falls back to console.error when reportError is unavailable', async () => {
    const failure = new Error('Session banner failed');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const FailingSessionBanner = () => {
      throw failure;
    };

    try {
      await renderMainLayout({SessionBanner: FailingSessionBanner});

      // The shell settles after the boundary catches, so wait for it before
      // asserting the fallback signal.
      expect(await screen.findByRole('banner')).toBeVisible();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to render session banner.', failure);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
