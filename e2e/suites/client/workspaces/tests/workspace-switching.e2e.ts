import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import {expect, test} from './test.js';
import {ONBOARDING_URL_RE, workspaceUrlRe} from './workspace-urls.js';

test.describe('workspace switching', () => {
  test('switches between workspaces from the top nav', async ({
    auth,
    page,
    projects,
    topNav,
    workspaceHome,
    workspaceSwitcher,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const workspaceAName = 'Alpha Workspace';
    const workspaceBName = 'Beta Workspace';
    const wsA = await workspaces.create({userId: user.user.id, name: workspaceAName});
    const wsB = await workspaces.create({userId: user.user.id, name: workspaceBName});
    await projects.createProject({workspaceId: wsA.id});
    await projects.createProject({workspaceId: wsB.id});
    await auth.loginAs(page, user);

    await workspaceHome.goto(wsA.slug);
    await expect(page).toHaveURL(workspaceUrlRe(wsA.slug));
    await workspaceSwitcher.open();
    await expect(workspaceSwitcher.workspaceOption(workspaceAName)).toBeVisible();
    await workspaceSwitcher.pickWorkspace(workspaceBName);

    await expect(page).toHaveURL(workspaceUrlRe(wsB.slug));
    await expect(topNav.currentWorkspace(workspaceBName)).toBeVisible();
    expect(await workspaceHome.readLastWorkspaceId(user.user.id)).toBe(wsB.id);
  });

  test('persists the active workspace across reload and via /', async ({
    auth,
    page,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
    const wsB = await workspaces.create({userId: user.user.id, name: 'Beta Workspace'});
    await auth.loginAs(page, user);

    await workspaceHome.gotoIntegrations(wsB.slug);
    await expect(page).toHaveURL(workspaceUrlRe(wsB.slug));
    await expect.poll(() => workspaceHome.readMaybeLastWorkspaceId(user.user.id)).toBe(wsB.id);
    await page.reload();
    await expect(page).toHaveURL(workspaceUrlRe(wsB.slug));
    await expect.poll(() => workspaceHome.readMaybeLastWorkspaceId(user.user.id)).toBe(wsB.id);
    await workspaceHome.gotoRoot();

    await expect(page).toHaveURL(workspaceUrlRe(wsB.slug));
    expect(page.url()).not.toMatch(workspaceUrlRe(wsA.slug));
  });

  test('routes a returning user with workspaces straight to /w/$workspaceSlug', async ({
    auth,
    page,
    workspaceHome,
    workspaces,
  }) => {
    const user = await auth.createUser();
    const wsA = await workspaces.create({userId: user.user.id, name: 'Alpha Workspace'});
    await auth.loginAs(page, user);
    const urlsSeen: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        urlsSeen.push(frame.url());
      }
    });

    await workspaceHome.gotoRoot();
    await expect(page).toHaveURL(workspaceUrlRe(wsA.slug));

    for (const url of urlsSeen) {
      expect(url, `transit URL must not flash through onboarding: ${url}`).not.toMatch(
        ONBOARDING_URL_RE,
      );
    }
    await stableScreenshot(page, 'workspaces/returning-user-home');
  });
});
