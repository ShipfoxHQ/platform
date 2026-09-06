import {config} from '@shipfox/e2e-core';
import {expect, test} from './test.js';

test('protects the composed MCP endpoint with OAuth metadata and Origin checks', async ({
  request,
}) => {
  const apiOrigin = new URL(config.API_URL).origin;
  const clientOrigin = new URL(config.CLIENT_BASE_URL).origin;

  const disallowed = await request.post(`${apiOrigin}/mcp`, {
    headers: {origin: 'https://agent-access-e2e-attacker.example.test'},
    data: {},
    failOnStatusCode: false,
  });
  expect(disallowed.status()).toBe(403);
  expect(await disallowed.json()).toEqual({code: 'origin-not-allowed'});

  const unauthenticated = await request.post(`${apiOrigin}/mcp`, {
    headers: {origin: clientOrigin},
    data: {},
    failOnStatusCode: false,
  });
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()['www-authenticate']).toContain('oauth-protected-resource');
});
