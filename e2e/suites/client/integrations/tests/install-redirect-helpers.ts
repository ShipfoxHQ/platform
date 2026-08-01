import type {Page} from '@shipfox/playwright';
import {expect} from './test.js';

export interface InstallRedirectExpectation {
  /** App route that mounts the RedirectInstallPage (e.g. /w/$workspaceSlug/integrations/sentry). */
  installPath: string;
  /** Glob matching the install POST endpoint, e.g. a trailing /integrations/sentry/install. */
  installEndpoint: string;
  /** External provider origin the page redirects to (e.g. https://sentry.io). */
  externalHost: string;
  /** install_url the stubbed endpoint returns and that the page must redirect to. */
  expectedUrl: string;
  /**
   * Runs inside the install-POST handler, after the body is captured but before
   * the response is fulfilled: i.e. while the app document is still intact and
   * the redirect has not fired. Sentry uses it to read its sessionStorage
   * handoff, which is unreadable once the aborted navigation denies the document.
   */
  beforeReleaseInstall?: () => void | Promise<void>;
}

// RedirectInstallPage fires the install POST on mount and then
// `window.location.assign(install_url)`. We register both routes BEFORE
// navigating (a route added after page.goto loses to the real backend),
// capture the attempted external URL inside the handler before aborting it
// (an aborted top-level navigation leaves no asserting-against final URL), and
// assert the install POST carried the workspace id so the test exercises more
// than mocked plumbing.
export async function assertInstallRedirect(
  page: Page,
  expectation: InstallRedirectExpectation,
): Promise<void> {
  let installBody: {workspace_id?: unknown} | undefined;
  let resolveNavigation!: (url: string) => void;
  const navigated = new Promise<string>((resolve) => {
    resolveNavigation = resolve;
  });

  await page.route(`${expectation.externalHost}/**`, async (route) => {
    resolveNavigation(route.request().url());
    await route.abort();
  });
  await page.route(expectation.installEndpoint, async (route) => {
    installBody = route.request().postDataJSON();
    await expectation.beforeReleaseInstall?.();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({install_url: expectation.expectedUrl}),
    });
  });

  await page.goto(expectation.installPath);
  const navigatedUrl = await navigated;

  expect(navigatedUrl).toBe(expectation.expectedUrl);
  expect(installBody?.workspace_id).toBeTruthy();
}
