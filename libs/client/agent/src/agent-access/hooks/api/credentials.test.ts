import {configureApiClient} from '@shipfox/client-api';
import {
  createAgentPersonalAccessToken,
  listAgentGrants,
  listAgentPersonalAccessTokens,
  revokeAgentGrant,
  revokeAgentPersonalAccessToken,
} from './credentials.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

describe('agent credential adapter', () => {
  test('lists mapped grants and PAT metadata without raw tokens', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          grants: [
            {
              id: CREDENTIAL_ID,
              client_name: 'Claude Desktop',
              workspace_id: WORKSPACE_ID,
              scopes: ['read'],
              created_at: '2026-09-01T10:00:00.000Z',
              last_refreshed_at: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          pats: [
            {
              id: CREDENTIAL_ID,
              workspace_id: WORKSPACE_ID,
              prefix: 'sf_pat_example',
              name: 'Local agent',
              expires_at: '2026-12-01T10:00:00.000Z',
              last_used_at: null,
              created_at: '2026-09-01T10:00:00.000Z',
            },
          ],
        }),
      );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(listAgentGrants()).resolves.toEqual([
      expect.objectContaining({clientName: 'Claude Desktop', workspaceId: WORKSPACE_ID}),
    ]);
    await expect(listAgentPersonalAccessTokens()).resolves.toEqual([
      expect.objectContaining({name: 'Local agent', prefix: 'sf_pat_example'}),
    ]);
  });

  test('creates a workspace-bound PAT and returns its one-time raw value', async () => {
    let body: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      body = await (input as Request).clone().json();
      return jsonResponse(
        {
          id: CREDENTIAL_ID,
          raw_token: 'sf_pat_secret-once',
          workspace_id: WORKSPACE_ID,
          prefix: 'sf_pat_secret',
          name: 'Local agent',
          expires_at: '2026-12-01T10:00:00.000Z',
          last_used_at: null,
          created_at: '2026-09-01T10:00:00.000Z',
        },
        {status: 201},
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const result = await createAgentPersonalAccessToken({
      workspaceId: WORKSPACE_ID,
      command: {name: 'Local agent', expiresInDays: 90},
    });

    expect(result.token).toBe('sf_pat_secret-once');
    expect(body).toEqual({
      workspace_id: WORKSPACE_ID,
      name: 'Local agent',
      expires_in_days: 90,
    });
  });

  test('revokes grants and PATs with idempotent DELETE requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await revokeAgentGrant(CREDENTIAL_ID);
    await revokeAgentPersonalAccessToken(CREDENTIAL_ID);

    const requests = fetchImpl.mock.calls.map((call) => call[0] as Request);
    expect(requests.map(({url, method}) => ({url, method}))).toEqual([
      {
        url: `https://api.example.test/agent-access/grants/${CREDENTIAL_ID}`,
        method: 'DELETE',
      },
      {
        url: `https://api.example.test/agent-access/pats/${CREDENTIAL_ID}`,
        method: 'DELETE',
      },
    ]);
  });
});
