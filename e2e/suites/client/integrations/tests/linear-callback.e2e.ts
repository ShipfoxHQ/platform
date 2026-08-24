import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

function linearConnectionFixture(workspaceId: string): IntegrationConnectionDto {
  return {
    id: '00000000-0000-4000-8000-0000000000ac',
    workspace_id: workspaceId,
    provider: 'linear',
    external_account_id: 'linear-org',
    slug: 'linear_acme',
    display_name: 'Linear acme',
    lifecycle_status: 'active',
    capabilities: ['agent_tools'],
    external_url: 'https://linear.app/acme/settings',
    created_at: '2026-01-15T12:00:00.000Z',
    updated_at: '2026-01-15T12:00:00.000Z',
  };
}

async function stubCallback(page: Page, response: {status: number; body: unknown}): Promise<void> {
  await page.route('**/integrations/linear/callback/api**', async (route) => {
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    });
  });
}

test('Linear callback renders recovery without submitting malformed params', async ({
  auth,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);

  let callbackRequested = false;
  await page.route('**/integrations/linear/callback/api**', async (route) => {
    callbackRequested = true;
    await route.abort();
  });

  await page.goto('/integrations/linear/callback?state=signed-state');

  await expect(page.getByRole('heading', {name: 'Invalid Linear callback'})).toBeVisible();
  expect(callbackRequested).toBe(false);
  await stableScreenshot(page, 'integrations/linear-callback-invalid');
});

test('Linear callback redirects to the verified workspace settings on success', async ({
  auth,
  integrationsCatalogue,
  page,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Linear Callback Workspace',
  });
  await auth.loginAs(page, user);
  await stubCallback(page, {status: 200, body: linearConnectionFixture(workspace.id)});

  await page.goto('/integrations/linear/callback?code=grant-code&state=signed-state');

  await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'));
  await expect(page.getByText('Linear installed.')).toBeVisible();
  await expect(integrationsCatalogue.emptyInstalledState()).toBeVisible();
  await stableScreenshot(page, 'integrations/linear-callback-success');
});

test('Linear callback presents the conflict recovery state', async ({auth, page, workspaces}) => {
  const user = await auth.createUser();
  await workspaces.create({userId: user.user.id});
  await auth.loginAs(page, user);
  await stubCallback(page, {
    status: 409,
    body: {
      code: 'linear-installation-already-linked',
      message: 'This Linear organization is already linked to another workspace.',
    },
  });

  await page.goto('/integrations/linear/callback?code=spent-code&state=signed-state');

  await expect(page.getByRole('heading', {name: 'Linear already linked'})).toBeVisible();
  await expect(
    page.getByText('This Linear organization is already linked to another workspace.'),
  ).toBeVisible();
  await expect(page.getByRole('link', {name: 'Back to Shipfox'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Start over'})).toHaveCount(0);
  await stableScreenshot(page, 'integrations/linear-callback-conflict');
});
