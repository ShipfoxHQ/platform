import {configureApiClient} from '@shipfox/client-api';
import {approveOAuthConsent, denyOAuthConsent, getOAuthConsent} from './consent.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

describe('OAuth consent adapter', () => {
  test('maps the dashboard-safe consent detail', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        request_id: REQUEST_ID,
        client_name: 'Claude Desktop',
        scope: 'read',
        expires_at: '2026-09-02T12:30:00.000Z',
        redirect_uri_hostname: '127.0.0.1',
        client_identity_kind: 'cimd',
        client_identity_origin: 'https://claude.ai',
        is_loopback_redirect: true,
        workspaces: [{workspace_id: WORKSPACE_ID, role: 'owner'}],
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(getOAuthConsent({requestId: REQUEST_ID})).resolves.toMatchObject({
      requestId: REQUEST_ID,
      clientName: 'Claude Desktop',
      redirectHostname: '127.0.0.1',
      clientIdentity: {kind: 'cimd', origin: 'https://claude.ai'},
      isLoopbackRedirect: true,
      workspaces: [{id: WORKSPACE_ID, role: 'owner'}],
    });
  });

  test('approves with only the explicit workspace selection', async () => {
    let body: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      body = await (input as Request).clone().json();
      return jsonResponse({redirect_url: 'http://127.0.0.1:4567/callback?code=server-code'});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(
      approveOAuthConsent({requestId: REQUEST_ID, workspaceId: WORKSPACE_ID}),
    ).resolves.toBe('http://127.0.0.1:4567/callback?code=server-code');

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(`https://api.example.test/oauth/consents/${REQUEST_ID}/approve`);
    expect(request.method).toBe('POST');
    expect(body).toEqual({workspace_id: WORKSPACE_ID});
  });

  test('denies without reconstructing the original OAuth request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({redirect_url: 'https://agent.example.test/denied'}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    await expect(denyOAuthConsent(REQUEST_ID)).resolves.toBe('https://agent.example.test/denied');

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(`https://api.example.test/oauth/consents/${REQUEST_ID}/deny`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBeNull();
  });
});
