import {assertInstallRedirect} from './install-redirect-helpers.js';
import {expect, test} from './test.js';

const SENTRY_INSTALL_URL = 'https://sentry.io/sentry-apps/test-app/external-install/';
const GITHUB_INSTALL_URL = 'https://github.com/apps/test-app/installations/new';
const LINEAR_INSTALL_URL = 'https://linear.app/oauth/authorize?state=test-state';
const SENTRY_INSTALL_WORKSPACE_KEY = 'shipfox.sentry-install.workspace-id';

test('Sentry install redirects to Sentry and stores the workspace handoff', async ({
  page,
  auth,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Sentry Install Workspace',
  });
  await auth.loginAs(page, user);

  await assertInstallRedirect(page, {
    installPath: `/w/${workspace.slug}/integrations/sentry`,
    installEndpoint: '**/integrations/sentry/install',
    externalHost: 'https://sentry.io',
    expectedUrl: SENTRY_INSTALL_URL,
    // Sentry's redirect carries no state param, so the install page stashes the
    // workspace id for the callback to pre-select. Read it before the redirect
    // fires: once the navigation is aborted the document denies storage access.
    beforeReleaseInstall: async () => {
      const storedWorkspaceId = await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        SENTRY_INSTALL_WORKSPACE_KEY,
      );
      expect(storedWorkspaceId).toBe(workspace.id);
    },
  });
});

test('GitHub install redirects to GitHub', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'GitHub Install Workspace',
  });
  await auth.loginAs(page, user);

  await assertInstallRedirect(page, {
    installPath: `/w/${workspace.slug}/integrations/github`,
    installEndpoint: '**/integrations/github/install',
    externalHost: 'https://github.com',
    expectedUrl: GITHUB_INSTALL_URL,
  });
});

test('Linear install redirects to Linear', async ({page, auth, workspaces}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({
    userId: user.user.id,
    name: 'Linear Install Workspace',
  });
  await auth.loginAs(page, user);

  await assertInstallRedirect(page, {
    installPath: `/w/${workspace.slug}/integrations/linear`,
    installEndpoint: '**/integrations/linear/install',
    externalHost: 'https://linear.app',
    expectedUrl: LINEAR_INSTALL_URL,
  });
});
