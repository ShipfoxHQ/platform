import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {INITIAL_CHECKLIST_COUNT_RE, stubChecklistDependencies} from './setup-checklist-fixtures.js';
import {expect, test} from './test.js';
import {
  ONBOARDING_URL_RE,
  SETUP_NAVIGATION_TIMEOUT_MS,
  WORKSPACE_INTEGRATIONS_URL_RE,
} from './workspace-urls.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
    const workspaceId = await workspaceHome.readLastWorkspaceId(user.user.id);
    await stubChecklistDependencies(page, workspaceId);
    await page.reload();
    await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
    await expect(setupShell.sourceControlHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await setupShell.expectNavigationHidden();

    const workspaceSlug = workspaceHome.currentWorkspaceSlug();
    expect(workspaceSlug).toBeTruthy();
    expect(workspaceSlug).not.toMatch(UUID_RE);
    await workspaceHome.gotoIntegrations(workspaceSlug as string);
    const org = await gitea.createOrg();
    await gitea.createRepo({org: org.org, name: 'platform'});
    await sourceControlSetup.providerLink(workspaceSlug as string, 'gitea').click();
    await providerInstall.installOrganization(org.org);
    await expect(sourceControlSetup.agentHarnessHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await sourceControlSetup.skipModelProviderButton().click();
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/projects/new/?$`, 'u'));
    await expect(workspaceHome.createProjectNameField()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await workspaceHome.createProject('E2E First Project');
    await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/?$`, 'u'));
    await expect(workspaceSetupChecklist.panel()).toBeVisible();
    await expect(workspaceSetupChecklist.heading()).toBeVisible();
    await expect(workspaceSetupChecklist.countLabel(INITIAL_CHECKLIST_COUNT_RE)).toBeVisible();
    await workspaceSetupChecklist.expandAllStepsIfNeeded();
    await expect(workspaceSetupChecklist.firstRow()).toContainText('Connect source control');
    await expect(workspaceSetupChecklist.indicator()).toBeVisible();
    await expect(workspaceSetupChecklist.indicator()).toHaveAttribute(
      'aria-label',
      INITIAL_CHECKLIST_COUNT_RE,
    );
    await workspaceHome.gotoSettingsGeneral();
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
});
