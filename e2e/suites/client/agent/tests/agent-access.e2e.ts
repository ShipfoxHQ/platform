import {createHash, randomBytes} from 'node:crypto';
import {config} from '@shipfox/e2e-core';
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
  const publicOrigin = new URL(process.env.API_PUBLIC_URL ?? config.API_URL).origin;
  const redirectUri = 'http://127.0.0.1:43124/oauth/callback';
  const registration = await request.post(`${apiOrigin}/oauth/register`, {
    data: {
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read',
    },
    failOnStatusCode: false,
  });
  expect(registration.status()).toBe(201);
  const registeredClient = (await registration.json()) as {client_id?: unknown};
  expect(registeredClient.client_id).toEqual(expect.any(String));
  const clientId = registeredClient.client_id;
  if (typeof clientId !== 'string')
    throw new Error('OAuth registration did not return a client id');

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = `browser-e2e-${randomBytes(8).toString('hex')}`;
  const authorizationUrl = new URL(`${apiOrigin}/oauth/authorize`);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: `${publicOrigin}/mcp`,
    scope: 'read',
    state,
  }).toString();
  const authorization = await request.get(authorizationUrl.toString(), {
    failOnStatusCode: false,
    maxRedirects: 0,
  });
  expect(authorization.status()).toBe(302);
  const consentLocation = authorization.headers().location;
  expect(consentLocation).toBeDefined();
  const requestId = new URL(consentLocation ?? '').searchParams.get('request_id');
  expect(requestId).toBeTruthy();
  if (!requestId) throw new Error('OAuth authorization did not return a consent request id');

  await page.goto(`/oauth/consent?request_id=${encodeURIComponent(requestId)}`);
  await expect(oauthConsent.heading(clientName)).toBeVisible();
  await expect(oauthConsent.identityText('External agent client')).toBeVisible();
  await expect(oauthConsent.identityText('registered client')).toBeVisible();
  await expect(oauthConsent.denyButton()).toBeVisible();
  await expect(oauthConsent.allowButton()).toBeVisible();

  await page.route(`${redirectUri}**`, (route) => route.fulfill({body: 'Agent callback'}));
  await oauthConsent.allowButton().click();
  await page.waitForURL((url) => url.origin === 'http://127.0.0.1:43124');
  const callback = new URL(page.url());
  expect(callback.pathname).toBe('/oauth/callback');
  expect(callback.searchParams.get('state')).toBe(state);
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
