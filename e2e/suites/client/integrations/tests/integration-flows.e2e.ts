import {expect, test} from './test.js';

const WORKSPACE_INTEGRATIONS_URL_RE = /\/w\/[^/]+\/integrations\/?$/u;
const GITEA_INSTALL_URL_RE = /\/w\/[^/]+\/integrations\/gitea\/?$/u;
const SETUP_NAVIGATION_TIMEOUT_MS = 15_000;

function modelProviderUrlRe(workspaceSlug: string): RegExp {
  return new RegExp(`/w/${workspaceSlug}/model-provider/?$`, 'u');
}

test('connecting Gitea from source-control setup opens model-provider setup', async ({
  page,
  auth,
  gitea,
  providerInstall,
  sourceControlSetup,
  workspaces,
}) => {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id, name: 'E2E Workspace'});
  await auth.loginAs(page, user);

  const org = await gitea.createOrg();

  await sourceControlSetup.gotoRoot();
  await expect(page).toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/integrations/?$`, 'u'));
  await expect(sourceControlSetup.heading()).toBeVisible();
  await expect(sourceControlSetup.projectTab()).toHaveCount(0);
  await expect(sourceControlSetup.settingsTab()).toHaveCount(0);
  await expect(sourceControlSetup.projectSwitcher()).toHaveCount(0);
  await expect(sourceControlSetup.workspaceSwitcher()).toBeVisible();

  await sourceControlSetup.providerLink(workspace.slug, 'gitea').click();
  await providerInstall.installOrganization(org.org);

  await expect(page).toHaveURL(modelProviderUrlRe(workspace.slug), {
    timeout: SETUP_NAVIGATION_TIMEOUT_MS,
  });
  await expect(page).not.toHaveURL(GITEA_INSTALL_URL_RE);
  await expect(page).not.toHaveURL(WORKSPACE_INTEGRATIONS_URL_RE);
  await expect(page).toHaveURL(modelProviderUrlRe(workspace.slug));
  await expect(sourceControlSetup.agentHarnessHeading()).toBeVisible();
  await expect(sourceControlSetup.projectTab()).toHaveCount(0);
  await expect(sourceControlSetup.settingsTab()).toHaveCount(0);
  await expect(sourceControlSetup.projectSwitcher()).toHaveCount(0);
  await expect(sourceControlSetup.workspaceSwitcher()).toBeVisible();
});
