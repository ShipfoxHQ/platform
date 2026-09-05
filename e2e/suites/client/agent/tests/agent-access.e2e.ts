import {config} from '@shipfox/e2e-core';
import {requestAgentAccessConsent} from '@shipfox/e2e-setup-auth';
import {expect, test} from './test.js';

test('routes the composed MCP connections settings surface and loads grant state', async ({
  agentAccessSettings,
  createReadyWorkspace,
  page,
}) => {
  const {workspaceSlug} = await createReadyWorkspace({name: 'Agent Access Settings Workspace'});

  await agentAccessSettings.goto(workspaceSlug);

  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/settings/agent-access/?$`, 'u'));
  await expect(agentAccessSettings.heading()).toBeVisible();
  await expect(agentAccessSettings.connectedAppsHeading()).toBeVisible();
  await expect(agentAccessSettings.emptyState()).toBeVisible();
});

test('reviews consent and disconnects an MCP app', async ({
  agentAccessSettings,
  createReadyWorkspace,
  oauthConsent,
  page,
  request,
}) => {
  const clientName = 'Agent Access browser E2E Client';
  const {workspaceSlug} = await createReadyWorkspace({
    name: 'Agent Access Consent Workspace',
  });
  await agentAccessSettings.goto(workspaceSlug);
  await expect(agentAccessSettings.heading()).toBeVisible();

  const apiOrigin = new URL(config.API_URL).origin;
  const publicOrigin = new URL(config.API_PUBLIC_URL).origin;
  const redirectUri = 'http://127.0.0.1:43124/oauth/callback';
  const authorization = await requestAgentAccessConsent({
    request,
    apiOrigin,
    publicOrigin,
    clientName,
    redirectUri,
    statePrefix: 'browser-e2e',
  });

  await page.goto(`/oauth/consent?request_id=${encodeURIComponent(authorization.requestId)}`);
  await expect(oauthConsent.heading(clientName)).toBeVisible();
  await expect(oauthConsent.identityText('External MCP client')).toBeVisible();
  await expect(oauthConsent.identityText('registered client')).toBeVisible();
  await expect(oauthConsent.denyButton()).toBeVisible();
  await expect(oauthConsent.allowButton()).toBeVisible();

  await page.route(`${redirectUri}**`, (route) => route.fulfill({body: 'Agent callback'}));
  await oauthConsent.allowButton().click();
  await page.waitForURL((url) => url.origin === 'http://127.0.0.1:43124');
  const callback = new URL(page.url());
  expect(callback.pathname).toBe('/oauth/callback');
  expect(callback.searchParams.get('state')).toBe(authorization.state);
  expect(callback.searchParams.get('code')).toEqual(expect.any(String));

  await agentAccessSettings.goto(workspaceSlug);
  await expect(agentAccessSettings.connectedAppRow(clientName)).toBeVisible();
  const cancelDialog = await agentAccessSettings.openDisconnectDialog(clientName);
  await cancelDialog.confirm('Cancel');
  await cancelDialog.expectClosed();

  const disconnectDialog = await agentAccessSettings.openDisconnectDialog(clientName);
  await disconnectDialog.confirm('Disconnect app');
  await expect(agentAccessSettings.emptyState()).toBeVisible();
});
