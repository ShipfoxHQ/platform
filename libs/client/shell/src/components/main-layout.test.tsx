import {screen} from '@testing-library/react';
import {defineClientFeature} from '#contract.js';
import type {ChromeSlots} from '#runtime/chrome-context.js';
import {defineRoute} from '#runtime/define-route.js';
import {renderComposedShell} from '#test/render.js';

function overviewFeature() {
  return defineClientFeature({
    id: 'acme.overview',
    routes: [{path: '/w/$workspaceSlug/overview', parent: 'workspaceLayout', impl: 'overview'}],
  });
}

async function renderMainLayout(chrome: Partial<ChromeSlots> = {}, hideProjectNavigation = false) {
  await renderComposedShell({
    features: [overviewFeature()],
    initialPath: '/w/workspace/overview',
    resolveImpl: () =>
      defineRoute({staticData: {frame: 'content'}, component: () => <h1>Overview</h1>}),
    chrome,
    workspaceSetup: async () => ({hideProjectNavigation}),
  });
}

describe('MainLayout session banner', () => {
  test('renders no banner strip when the slot is absent', async () => {
    await renderMainLayout();

    expect(screen.queryByText('Session banner')).not.toBeInTheDocument();
    expect(await screen.findByRole('main')).toHaveClass('[--app-content-h:calc(100dvh_-_96px)]');
  });

  test('renders a composed session banner above the navigation bar', async () => {
    await renderMainLayout({SessionBanner: () => <div>Session banner</div>});

    const banner = await screen.findByText('Session banner');
    expect(banner).toBeVisible();
    expect(
      banner.compareDocumentPosition(await screen.findByRole('banner')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('main')).toHaveClass('[--app-content-h:calc(100dvh_-_136px)]');
  });

  test.each([
    ['project navigation', false, false, '[--app-content-h:calc(100dvh_-_96px)]'],
    ['project navigation and banner', true, false, '[--app-content-h:calc(100dvh_-_136px)]'],
    ['hidden project navigation', false, true, '[--app-content-h:calc(100dvh_-_56px)]'],
    ['hidden project navigation and banner', true, true, '[--app-content-h:calc(100dvh_-_96px)]'],
  ])('keeps the app-content viewport arithmetic consistent with %s', async (_, withBanner, hideProjectNavigation, expectedAppContentHeight) => {
    await renderMainLayout(
      withBanner ? {SessionBanner: () => <div>Session banner</div>} : {},
      hideProjectNavigation,
    );

    expect(await screen.findByRole('main')).toHaveClass(expectedAppContentHeight);
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
      expect(screen.getByRole('main')).toHaveClass('[--app-content-h:calc(100dvh_-_136px)]');
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
});
