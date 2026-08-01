import {randomUUID} from 'node:crypto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {expect, test} from './test.js';
import {
  ONBOARDING_URL_RE,
  SETUP_NAVIGATION_TIMEOUT_MS,
  WORKSPACE_INTEGRATIONS_URL_RE,
} from './workspace-urls.js';

const UUID_RE = /^[0-9a-f-]{36}$/u;

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
    page,
    setupShell,
    workspaceHome,
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
    const lastWorkspaceId = await workspaceHome.readLastWorkspaceId(user.user.id);
    expect(lastWorkspaceId).toMatch(UUID_RE);
    await stableScreenshot(page, 'workspaces/onboarding-complete');
    await workspaceSwitcher.open();
    expect(await workspaceSwitcher.workspaceOption(workspaceName).getAttribute('data-value')).toBe(
      lastWorkspaceId,
    );
  });
});
