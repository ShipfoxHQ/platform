import {expect, test} from './test.js';
import {
  ONBOARDING_URL_RE,
  WORKSPACE_INTEGRATIONS_URL_RE,
  workspaceUrlRe,
} from './workspace-urls.js';

test.describe('workspace switcher', () => {
  test('creates a second workspace from the switcher mid-session', async ({
    auth,
    page,
    projects,
    setupShell,
    workspaceHome,
    workspaceOnboarding,
    workspaceSwitcher,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspaceAName = 'Alpha Workspace';
    const workspaceBName = 'Beta Workspace';
    const wsA = await workspaces.create({userId: user.user.id, name: workspaceAName});
    await projects.createProject({workspaceId: wsA.id});
    await auth.loginAs(page, user);

    await workspaceHome.goto(wsA.slug);
    await workspaceSwitcher.open();
    await expect(workspaceSwitcher.workspaceOption(workspaceAName)).toBeVisible();
    await expect(workspaceSwitcher.createWorkspaceOption()).toBeVisible();
    await workspaceSwitcher.clickCreateWorkspace();
    await expect(page).toHaveURL(ONBOARDING_URL_RE);
    await workspaceOnboarding.createWorkspace(workspaceBName);

    await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
    await setupShell.expectNavigationHidden();
    const newWorkspaceSlug = workspaceHome.currentWorkspaceSlug();
    expect(newWorkspaceSlug).toBeTruthy();
    expect(newWorkspaceSlug).not.toBe(wsA.slug);
    await workspaceSwitcher.open();
    await expect(workspaceSwitcher.workspaceOption(workspaceAName)).toBeVisible();
    await expect(workspaceSwitcher.workspaceOption(workspaceBName)).toBeVisible();
    expect(await workspaceHome.readLastWorkspaceId(user.user.id)).not.toBe(wsA.id);
  });

  test('keeps Create workspace visible when search filters every workspace out', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSwitcher,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
    await projects.createProject({workspaceId: wsA.id});
    await auth.loginAs(page, user);

    await workspaceHome.goto(wsA.slug);
    await workspaceSwitcher.open();
    await workspaceSwitcher.search('zzz-no-match');

    await expect(workspaceSwitcher.noResults()).toBeVisible();
    await expect(workspaceSwitcher.createWorkspaceOption()).toBeVisible();
    await workspaceSwitcher.pressEnter();
    await expect(page).toHaveURL(ONBOARDING_URL_RE);
  });

  test('keeps Create workspace pinned while the workspace list scrolls', async ({
    auth,
    page,
    projects,
    workspaceHome,
    workspaceSwitcher,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const first = await workspaces.create({userId: user.user.id, name: 'Workspace 01'});
    await projects.createProject({workspaceId: first.id});
    for (let i = 2; i <= 20; i += 1) {
      const name = `Workspace ${String(i).padStart(2, '0')}`;
      await workspaces.create({userId: user.user.id, name});
    }
    await auth.loginAs(page, user);

    await workspaceHome.goto(first.slug);
    await expect(page).toHaveURL(workspaceUrlRe(first.slug));
    await workspaceSwitcher.open();
    await expect(workspaceSwitcher.workspaceOption('Workspace 01')).toBeVisible();
    await expect(workspaceSwitcher.createWorkspaceOption()).toBeVisible();
    await workspaceSwitcher.scrollWorkspaceOptionsToEnd();

    await expect(workspaceSwitcher.workspaceOption('Workspace 20')).toBeInViewport();
    await expect(workspaceSwitcher.createWorkspaceOption()).toBeVisible();
  });
});
