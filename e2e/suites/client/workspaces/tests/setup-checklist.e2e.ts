import {randomUUID} from 'node:crypto';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import {
  CLOUD_CHECKLIST_COUNT_RE,
  INITIAL_CHECKLIST_COUNT_RE,
  LINEAR_CHECKLIST_COUNT_RE,
  stubChecklistDependencies,
} from './setup-checklist-fixtures.js';
import {expect, test} from './test.js';

test.describe('workspace setup checklist', () => {
  test('tracks a Linear installation, dismissal, and settings re-entry', async ({
    auth,
    integrationsCatalogue,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Setup Guide Workspace',
    });
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);
    await stubChecklistDependencies(page, workspace.id);

    await page.route('**/integrations/linear/callback/api**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '00000000-0000-4000-8000-0000000000ad',
          workspace_id: workspace.id,
          provider: 'linear',
          external_account_id: 'linear-e2e-org',
          slug: 'linear_e2e',
          display_name: 'Linear E2E',
          lifecycle_status: 'active',
          capabilities: ['agent_tools'],
          external_url: 'https://linear.app/e2e',
          created_at: '2026-01-15T12:00:00.000Z',
          updated_at: '2026-01-15T12:00:00.000Z',
        }),
      });
    });

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.panel()).toBeVisible();
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      INITIAL_CHECKLIST_COUNT_RE,
    );
    const linearOrganizationId = `linear-e2e-org-${randomUUID()}`;
    await test.step('install Linear and verify checklist progress', async () => {
      await workspaceSetupChecklist.connectLink().click();
      await expect(page).toHaveURL(
        new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'),
      );
      let resolveLinearNavigation!: (url: string) => void;
      const linearNavigation = new Promise<string>((resolve) => {
        resolveLinearNavigation = resolve;
      });
      await page.route('https://linear.app/**', async (route) => {
        resolveLinearNavigation(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><title>Linear OAuth</title>',
        });
      });
      await integrationsCatalogue.installLink('Linear').click();
      const navigatedUrl = await linearNavigation;
      const linearInstallUrl = new URL(navigatedUrl);
      expect(linearInstallUrl.origin + linearInstallUrl.pathname).toBe(
        'https://linear.app/oauth/authorize',
      );
      await createLinearConnection({
        workspaceId: workspace.id,
        organizationId: linearOrganizationId,
        organizationUrlKey: `linear-e2e-${linearOrganizationId}`,
        appUserId: `linear-e2e-app-user-${linearOrganizationId}`,
        displayName: 'Linear E2E',
        accessToken: `linear-e2e-token-${linearOrganizationId}`,
      });
      await page.goto('/integrations/linear/callback?code=e2e-code&state=e2e-state');
      await expect(page).toHaveURL(
        new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'),
      );
      await workspaceHome.goto(workspace.slug);
      await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
        'aria-label',
        LINEAR_CHECKLIST_COUNT_RE,
      );
      await expect(workspaceSetupChecklist.status()).toHaveAttribute('aria-live', 'polite');
      await expect(workspaceSetupChecklist.status()).toHaveText(LINEAR_CHECKLIST_COUNT_RE);
      await expect(workspaceSetupChecklist.text('Set up runner capacity')).toBeVisible();
    });

    await test.step('dismiss and re-enter the setup guide', async () => {
      await workspaceSetupChecklist.indicator().click();
      await expect(workspaceSetupChecklist.text('Set up runner capacity')).toBeVisible();
      await workspaceSetupChecklist.hideButton().click();
      await expect(workspaceSetupChecklist.panel()).toHaveCount(0);
      await expect(workspaceSetupChecklist.indicator()).toHaveCount(0);
      await workspaceHome.gotoSettingsGeneral(workspace.slug);
      await expect(workspaceHome.showSetupGuideButton()).toBeVisible();
      await workspaceHome.showSetupGuideButton().click();
      await expect(workspaceHome.showSetupGuideButton()).toHaveCount(0);
      await workspaceHome.goto(workspace.slug);
      await expect(workspaceSetupChecklist.panel()).toBeVisible();
    });

    await test.step('open and close the setup guide with the keyboard', async () => {
      await workspaceSetupChecklist.indicator().focus();
      await page.keyboard.press('Enter');
      await expect(workspaceSetupChecklist.dialog()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(workspaceSetupChecklist.dialog()).toHaveCount(0);
      await expect(workspaceSetupChecklist.indicator()).toBeFocused();
    });
  });

  test('completes the checklist when the installation provides runners and inference', async ({
    auth,
    integrationsCatalogue,
    page,
    projects,
    workspaceHome,
    workspaceSetupChecklist,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Cloud Setup Guide Workspace',
    });
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);
    await stubChecklistDependencies(page, workspace.id, 'managed');

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.countLabel(CLOUD_CHECKLIST_COUNT_RE)).toBeVisible();

    const linearOrganizationId = `linear-cloud-e2e-org-${randomUUID()}`;
    await createLinearConnection({
      workspaceId: workspace.id,
      organizationId: linearOrganizationId,
      organizationUrlKey: `linear-cloud-e2e-${linearOrganizationId}`,
      appUserId: `linear-cloud-e2e-app-user-${linearOrganizationId}`,
      displayName: 'Linear Cloud E2E',
      accessToken: `linear-cloud-e2e-token-${linearOrganizationId}`,
    });
    await test.step('refresh the mounted checklist from the integration settings', async () => {
      await workspaceSetupChecklist.connectLink().click();
      await expect(page).toHaveURL(
        new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'),
      );
      await expect(integrationsCatalogue.installedProviderName('Linear Cloud E2E')).toBeVisible();
      await expect(workspaceSetupChecklist.status()).toHaveText("You're set up");
    });
    await workspaceSetupChecklist.indicator().click();
    await expect(workspaceSetupChecklist.completionMessage()).toBeVisible();
    await workspaceSetupChecklist.doneButton().click();
    await expect(workspaceSetupChecklist.panel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveCount(0);
  });
});
