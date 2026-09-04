import {expect, test} from './test.js';

test('routes the composed Agent access settings surface and loads grant state', async ({
  agentAccessSettings,
  createReadyWorkspace,
  page,
}) => {
  const {workspaceSlug} = await createReadyWorkspace({name: 'Agent Access Settings Workspace'});

  await agentAccessSettings.goto(workspaceSlug);

  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/settings/agent-access/?$`, 'u'));
  await expect(agentAccessSettings.heading()).toBeVisible();
  await expect(agentAccessSettings.authorizedAppsHeading()).toBeVisible();
  await expect(agentAccessSettings.emptyState()).toBeVisible();
});
