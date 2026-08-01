import {expect, test} from './test.js';
import {SETUP_NAVIGATION_TIMEOUT_MS} from './workspace-urls.js';

test.describe('workspace settings routing', () => {
  test('routes workspace settings to members by default', async ({
    auth,
    membersSettings,
    page,
    projects,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({userId: user.user.id, name: 'Settings Workspace'});
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);

    await membersSettings.gotoDefault(workspace.slug);

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/members/?$`, 'u'));
    await expect(membersSettings.heading()).toBeVisible();
  });

  test('routes setup workspace settings back to source-control onboarding', async ({
    auth,
    page,
    setupShell,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Setup Settings Workspace',
    });
    await auth.loginAs(page, user);

    await workspaceHome.gotoSettings(workspace.slug);

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/integrations/?$`, 'u'));
    await expect(setupShell.sourceControlHeading()).toBeVisible({
      timeout: SETUP_NAVIGATION_TIMEOUT_MS,
    });
    await setupShell.expectNavigationHidden();
  });

  test('settings tab opens members settings', async ({
    auth,
    membersSettings,
    page,
    projects,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspace = await workspaces.create({
      userId: user.user.id,
      name: 'Settings Tab Workspace',
    });
    await projects.createProject({workspaceId: workspace.id});
    await auth.loginAs(page, user);

    await workspaceHome.goto(workspace.slug);
    await workspaceHome.settingsTab().click();

    await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/settings/members/?$`, 'u'));
    await expect(membersSettings.heading()).toBeVisible();
  });
});
