import {configureApiClient} from '@shipfox/client-api';
import {listAgentGrants, revokeAgentGrant} from './credentials.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GRANT_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

describe('agent grant adapter', () => {
  test('lists mapped OAuth grants', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        grants: [
          {
            id: GRANT_ID,
            client_name: 'Claude Desktop',
            workspace_id: WORKSPACE_ID,
            scopes: ['read'],
            created_at: '2026-09-01T10:00:00.000Z',
            last_refreshed_at: null,
          },
        ],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(listAgentGrants()).resolves.toEqual([
      expect.objectContaining({clientName: 'Claude Desktop', workspaceId: WORKSPACE_ID}),
    ]);
  });

  test('revokes a grant with DELETE', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await revokeAgentGrant(GRANT_ID);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect({url: request.url, method: request.method}).toEqual({
      url: `https://api.example.test/agent-access/grants/${GRANT_ID}`,
      method: 'DELETE',
    });
  });
});
