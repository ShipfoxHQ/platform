import {configureApiClient} from '@shipfox/client-api';
import {
  checkWorkspaceSlugAvailability,
  createWorkspace,
  updateWorkspace,
} from './workspace-auth.js';

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
    expect(result.slug).toBe('acme');
    expect(request.url).toBe('https://api.example.test/workspaces');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({name: 'Acme', slug: 'acme'});
  });
});

describe('updateWorkspace', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('patches the workspace body', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Acme Labs',
        slug: 'acme-labs',
        status: 'active',
        settings: {},
        created_at: '2026-04-27T00:00:00.000Z',
        updated_at: '2026-04-27T00:00:00.000Z',
      });
    });
    configureApiClient({fetchImpl});

    const result = await updateWorkspace({
      workspaceId: '33333333-3333-4333-8333-333333333333',
      name: 'Acme Labs',
      slug: 'acme-labs',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.slug).toBe('acme-labs');
    expect(request.url).toBe(
      'https://api.example.test/workspaces/33333333-3333-4333-8333-333333333333',
    );
    expect(request.method).toBe('PATCH');
    expect(requestBody).toEqual({name: 'Acme Labs', slug: 'acme-labs'});
  });
});

describe('checkWorkspaceSlugAvailability', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('encodes the slug and returns the server result', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({available: true}));
    configureApiClient({fetchImpl});

    const slug = 'acme/labs?region=eu';
    await expect(checkWorkspaceSlugAvailability(slug)).resolves.toBe(true);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    const url = new URL(request.url);
    expect(url.pathname).toBe('/workspaces/slug-availability');
    expect(url.search).toBe(`?slug=${encodeURIComponent(slug)}`);
    expect(request.method).toBe('GET');
  });
});
