import {configureApiClient} from '@shipfox/client-api';
import {createWorkspace} from './workspace-auth.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('createWorkspace', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts the workspace body', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Acme',
        slug: 'acme',
        status: 'active',
        settings: {},
        created_at: '2026-04-27T00:00:00.000Z',
        updated_at: '2026-04-27T00:00:00.000Z',
      });
    });
    configureApiClient({fetchImpl});

    const result = await createWorkspace({name: 'Acme', slug: 'acme'});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.name).toBe('Acme');
    expect(request.url).toBe('https://api.example.test/workspaces');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({name: 'Acme', slug: 'acme'});
  });
});
