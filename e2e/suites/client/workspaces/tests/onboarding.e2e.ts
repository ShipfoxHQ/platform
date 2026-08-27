import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {createLinearConnection} from '@shipfox/e2e-setup-integrations';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';
import {
  ONBOARDING_URL_RE,
  SETUP_NAVIGATION_TIMEOUT_MS,
  WORKSPACE_INTEGRATIONS_URL_RE,
} from './workspace-urls.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INITIAL_CHECKLIST_COUNT_RE = /2 of 4 done/u;
const LINEAR_CHECKLIST_COUNT_RE = /3 of 4 done/u;
const CLOUD_CHECKLIST_COUNT_RE = /2 of 3 done/u;

async function stubModelProviderDependencies(page: Page, workspaceId: string) {
  await page.route('**/agent/model-provider-catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [],
        managed_provider_id: 'managed-default',
        instance_default_provider_id: null,
      }),
    });
  });
  await page.route(`**/workspaces/${workspaceId}/agent/model-providers`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({configs: [], default_provider_id: null, default_harness_id: null}),
    });
  });
}

async function stubChecklistDependencies(page: Page, workspaceId: string) {
  await page.route(`**/workspaces/${workspaceId}/provisioners/active`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({provisioners: [], installation_runners: 'none'}),
    });
  });
  await stubModelProviderDependencies(page, workspaceId);
}

test.describe('workspace onboarding', () => {
  test('redirects a no-workspace user from / to onboarding', async ({
    auth,
    page,
    workspaceOnboarding,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);

    await workspaceOnboarding.gotoRoot();

    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await expect(workspaceOnboarding.heading()).toBeVisible();
    await expect(workspaceOnboarding.workspaceNameField()).toBeVisible();
    await stableScreenshot(page, 'workspaces/onboarding-blank');
  });

  test('redirects a no-workspace user from a workspace deep-link to onboarding', async ({
    auth,
    page,
    workspaceOnboarding,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);

    await workspaceOnboarding.gotoWorkspace(randomUUID());

    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await expect(workspaceOnboarding.heading()).toBeVisible();
  });

  test('creates the first workspace via onboarding and persists lastWorkspaceId', async ({
    auth,
    gitea,
    page,
    providerInstall,
    setupShell,
    sourceControlSetup,
    workspaceHome,
    workspaceSetupChecklist,
    workspaceOnboarding,
    workspaceSwitcher,
  }) => {
    const user = await auth.createUser();
    await auth.loginAs(page, user);
    const workspaceName = 'E2E Onboarding Workspace';

    await workspaceOnboarding.gotoRoot();
    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await workspaceOnboarding.createWorkspace(workspaceName);

    await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
    await expect(setupShell.sourceControlHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await setupShell.expectNavigationHidden();

    const workspaceSlug = workspaceHome.currentWorkspaceSlug();
    expect(workspaceSlug).toBeTruthy();
    expect(workspaceSlug).not.toMatch(UUID_RE);
    await stubChecklistDependencies(page, await workspaceHome.readLastWorkspaceId(user.user.id));
    await workspaceHome.gotoSettingsGeneral(workspaceSlug as string);
    await expect(workspaceSetupChecklist.indicator()).toBeVisible();
    await workspaceHome.gotoIntegrations(workspaceSlug as string);
    const org = await gitea.createOrg();
    await sourceControlSetup.providerLink(workspaceSlug as string, 'gitea').click();
    await providerInstall.installOrganization(org.org);
    await expect(sourceControlSetup.agentHarnessHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await sourceControlSetup.skipModelProviderButton().click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/projects/new/?$`, 'u'));
    await workspaceHome.gotoModelProvider(workspaceSlug as string);
    await workspaceHome.gotoNewProject(workspaceSlug as string);
    await workspaceHome.createProject('E2E First Project');
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`, 'u'));
    await expect(workspaceSetupChecklist.panel()).toBeVisible();
    await expect(workspaceSetupChecklist.heading()).toBeVisible();
    await expect(workspaceSetupChecklist.countLabel(INITIAL_CHECKLIST_COUNT_RE)).toBeVisible();
    await expect(workspaceSetupChecklist.firstRow()).toContainText('Connect source control');
    await expect(workspaceSetupChecklist.indicator()).toBeVisible();
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      INITIAL_CHECKLIST_COUNT_RE,
    );
    await workspaceHome.gotoSettingsGeneral(workspaceSlug as string);
    await expect(workspaceSetupChecklist.indicator()).toBeVisible();
    await workspaceHome.goto(workspaceSlug as string);
    const lastWorkspaceId = await workspaceHome.readLastWorkspaceId(user.user.id);
    expect(lastWorkspaceId).toMatch(UUID_RE);
    await stableScreenshot(page, 'workspaces/onboarding-complete');
    await workspaceSwitcher.open();
    const workspaceOption = workspaceSwitcher.workspaceOption(workspaceName);
    await expect(workspaceOption).toBeVisible();
    expect(await workspaceOption.getAttribute('data-value')).toBe(lastWorkspaceId);
  });

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
    await test.step('install Linear and verify checklist progress', async () => {
      await workspaceSetupChecklist.connectLink().click();
      await expect(page).toHaveURL(
        new RegExp(`/w/${workspace.slug}/settings/integrations/?$`, 'u'),
      );
      await integrationsCatalogue.installLink('Linear').click();
      await createLinearConnection({
        workspaceId: workspace.id,
        organizationId: 'linear-e2e-org',
        organizationUrlKey: 'linear-e2e',
        appUserId: 'linear-e2e-app-user',
        displayName: 'Linear E2E',
        accessToken: 'linear-e2e-token',
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

    await workspaceSetupChecklist.indicator().focus();
    await page.keyboard.press('Enter');
    await expect(workspaceSetupChecklist.panel()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(workspaceSetupChecklist.panel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toBeFocused();
  });

  test('completes the checklist when the installation provides runners and inference', async ({
    auth,
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

    await stubModelProviderDependencies(page, workspace.id);

    await workspaceHome.goto(workspace.slug);
    await expect(workspaceSetupChecklist.countLabel(CLOUD_CHECKLIST_COUNT_RE)).toBeVisible();

    await createLinearConnection({
      workspaceId: workspace.id,
      organizationId: 'linear-cloud-e2e-org',
      organizationUrlKey: 'linear-cloud-e2e',
      appUserId: 'linear-cloud-e2e-app-user',
      displayName: 'Linear Cloud E2E',
      accessToken: 'linear-cloud-e2e-token',
    });
    await expect(workspaceSetupChecklist.completionMessage()).toBeVisible();
    await expect(workspaceSetupChecklist.status()).toHaveText("You're set up");
    await workspaceSetupChecklist.doneButton().click();
    await expect(workspaceSetupChecklist.panel()).toHaveCount(0);
    await expect(workspaceSetupChecklist.indicator()).toHaveCount(0);
  });
});
