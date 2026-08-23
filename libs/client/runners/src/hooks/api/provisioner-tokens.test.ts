import {configureApiClient} from '@shipfox/client-api';
import {
  createProvisionerToken,
  listActiveProvisioners,
  listProvisionerTokens,
  revokeProvisionerToken,
} from './provisioner-tokens.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

const workspaceId = '11111111-1111-4111-8111-111111111111';
const tokenId = '33333333-3333-4333-8333-333333333333';

describe('provisioner token transports', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('lists provisioner tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({tokens: []}));
    configureApiClient({fetchImpl});

    const result = await listProvisionerTokens({workspaceId});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result).toEqual([]);
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${workspaceId}/provisioners/tokens`,
    );
    expect(request.method).toBe('GET');
  });

  test('posts token creation body', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse(
        {
          id: tokenId,
          scope: 'workspace',
          raw_token: 'sf_pt_raw-created-token',
          prefix: 'sf_pt_raw-c',
          name: 'Docker provisioner',
          workspace_id: workspaceId,
          created_by_user_id: '22222222-2222-4222-8222-222222222222',
          revoked_by_user_id: null,
          expires_at: '2026-05-09T00:00:00.000Z',
          revoked_at: null,
          last_seen_at: null,
          created_at: '2026-05-08T00:00:00.000Z',
          updated_at: '2026-05-08T00:00:00.000Z',
        },
        {status: 201},
      );
    });
    configureApiClient({fetchImpl});
    const command = {
      name: 'Docker provisioner',
      expiration: {kind: 'expires-after' as const, seconds: 86_400},
    };

    const result = await createProvisionerToken({workspaceId, command});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.token).toBe('sf_pt_raw-created-token');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${workspaceId}/provisioners/tokens`,
    );
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({name: 'Docker provisioner', ttl_seconds: 86_400});
  });

  test('posts to the token revoke endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        id: tokenId,
        scope: 'workspace',
        workspace_id: workspaceId,
        prefix: 'sf_pt_abcde',
        name: 'Docker provisioner',
        created_by_user_id: '22222222-2222-4222-8222-222222222222',
        revoked_by_user_id: '22222222-2222-4222-8222-222222222222',
        expires_at: '2026-05-09T00:00:00.000Z',
        revoked_at: '2026-05-08T01:00:00.000Z',
        last_seen_at: null,
        created_at: '2026-05-08T00:00:00.000Z',
        updated_at: '2026-05-08T01:00:00.000Z',
      }),
    );
    configureApiClient({fetchImpl});

    const result = await revokeProvisionerToken({workspaceId, tokenId});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.revokedAt).toBe('2026-05-08T01:00:00.000Z');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${workspaceId}/provisioners/tokens/${tokenId}/revoke`,
    );
    expect(request.method).toBe('POST');
  });

  test('lists active provisioners with their installation runners status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        provisioners: [
          {
            id: tokenId,
            name: 'Docker provisioner',
            prefix: 'sf_pt_abcde',
            last_seen_at: '2026-05-08T01:00:00.000Z',
          },
        ],
        installation_runners: 'managed',
      }),
    );
    configureApiClient({fetchImpl});

    const result = await listActiveProvisioners({workspaceId});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.provisioners).toHaveLength(1);
    expect(result.installationRunners).toBe('managed');
    expect(request.url).toBe(
      `https://api.example.test/workspaces/${workspaceId}/provisioners/active`,
    );
    expect(request.method).toBe('GET');
  });
});
