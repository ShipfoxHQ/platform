import type {SentryConnectResponseDto} from '@shipfox/api-integration-sentry-dto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const CALLBACK_URL =
  '/integrations/sentry/callback?code=test-code&installation_id=test-install&org_slug=acme';

// Typed against the real connect response DTO so a contract change fails
// `turbo type` instead of letting the stub pass on a stale shape (e2e packages
// import *-dto packages for types only: see settings-catalogue.e2e.ts).
function sentryConnectionFixture(workspaceId: string): SentryConnectResponseDto {
  return {
    id: '00000000-0000-4000-8000-0000000000ab',
    workspace_id: workspaceId,
    provider: 'sentry',
    external_account_id: 'acme',
    slug: 'sentry_acme',
    display_name: 'Sentry acme',
    lifecycle_status: 'active',
    capabilities: [],
    external_url: 'https://acme.sentry.io/',
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-15T12:00:00.000Z',
  };
}

async function stubConnect(page: Page, response: {status: number; body: unknown}): Promise<void> {
  await page.route('**/integrations/sentry/connect', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

test('Sentry callback shows an error when required params are missing', async ({
  auth,
  page,
  sentryCallback,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);

  await sentryCallback.goto('/integrations/sentry/callback');

  await expect(
    sentryCallback.message(
      'This Sentry link is missing required parameters. Start the install again from your workspace settings.',
    ),
  ).toBeVisible();
  await expect(sentryCallback.backToShipfoxLink()).toBeVisible();

  await stableScreenshot(page, 'integrations/sentry-callback-missing-params');
});

test('Sentry callback shows the workspace picker', async ({
  page,
  auth,
  sentryCallback,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Picker Workspace'});
  await auth.loginAs(page, user);

  await sentryCallback.goto(CALLBACK_URL);

  await expect(sentryCallback.heading()).toBeVisible();
  await expect(
    sentryCallback.message('Install the Sentry org "acme" in a workspace.'),
  ).toBeVisible();
  await expect(sentryCallback.installButton()).toBeVisible();

  await stableScreenshot(page, 'integrations/sentry-callback-pick-workspace');
});

test('Sentry callback installs to a workspace on success', async ({
  page,
  auth,
  projects,
  sentryCallback,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Sentry Install Workspace',
  });
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, user);

  await stubConnect(page, {status: 200, body: sentryConnectionFixture(workspace.id)});

  await sentryCallback.goto(CALLBACK_URL);
  await expect(sentryCallback.heading()).toBeVisible();
  await sentryCallback.installButton().click();

  // The stub never persisted a connection, so we assert only the success toast
  // and the redirect target. Sentry does not need to appear in the gallery.
  await expect(sentryCallback.message('Sentry installed.')).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/workspaces/${workspace.id}/settings/integrations/?$`, 'u'),
  );
});

test('Sentry callback offers Start over on a terminal failure', async ({
  page,
  auth,
  sentryCallback,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Terminal Workspace'});
  await auth.loginAs(page, user);

  // A spent grant code returns a 4xx with no recovery except a fresh install,
  // so classifySentryConnectError yields a terminal failure with startOver.
  await stubConnect(page, {
    status: 400,
    body: {
      message: 'This Sentry link could not be completed. Start the install again.',
      code: 'access-denied',
    },
  });

  await sentryCallback.goto(
    '/integrations/sentry/callback?code=spent-code&installation_id=test-install&org_slug=acme',
  );
  await sentryCallback.installButton().click();

  await expect(
    sentryCallback.message(
      'Sentry did not accept this install. Start the install again from workspace settings.',
    ),
  ).toBeVisible();
  await expect(sentryCallback.startOverLink()).toBeVisible();

  await stableScreenshot(page, 'integrations/sentry-callback-terminal');
});

test('Sentry callback offers Retry on a retryable failure', async ({
  page,
  auth,
  sentryCallback,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id, name: 'Sentry Retry Workspace'});
  await auth.loginAs(page, user);

  // A rate-limit (no retry-after window) classifies as retryable, so the Retry
  // button stays enabled.
  await stubConnect(page, {
    status: 429,
    body: {message: 'Sentry is rate limiting requests.', code: 'rate-limited'},
  });

  await sentryCallback.goto(CALLBACK_URL);
  await sentryCallback.installButton().click();

  await expect(
    sentryCallback.message('Sentry is rate limiting requests. Try again in a moment.'),
  ).toBeVisible();
  await expect(sentryCallback.retryButton()).toBeVisible();

  await stableScreenshot(page, 'integrations/sentry-callback-retryable');
});
