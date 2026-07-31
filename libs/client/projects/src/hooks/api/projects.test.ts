import {configureApiClient} from '@shipfox/client-api';
import {createProject, listProjects} from './projects.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

describe('listProjects', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('includes workspace, limit, cursor, and search params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({projects: [], next_cursor: null}));
    configureApiClient({fetchImpl});

    const result = await listProjects({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      limit: 25,
      cursor: 'cursor-1',
      search: 'platform api',
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    const url = new URL(request.url);
    expect(result.projects).toEqual([]);
    expect(url.pathname).toBe('/projects');
    expect(url.searchParams.get('workspace_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('cursor')).toBe('cursor-1');
    expect(url.searchParams.get('search')).toBe('platform api');
  });
});

describe('createProject', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('posts the project body', async () => {
    let requestBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      requestBody = await (input as Request).clone().json();
      return jsonResponse({
        id: '44444444-4444-4444-8444-444444444444',
        workspace_id: '11111111-1111-4111-8111-111111111111',
        name: 'Platform',
        slug: 'platform',
        source: {
          connection_id: '33333333-3333-4333-8333-333333333333',
          external_repository_id: 'platform',
        },
        created_at: '2026-05-07T01:00:00.000Z',
        updated_at: '2026-05-07T01:00:00.000Z',
      });
    });
    configureApiClient({fetchImpl});
    const body = {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      name: 'Platform',
      slug: 'platform',
      source: {
        connectionId: '33333333-3333-4333-8333-333333333333',
        externalRepositoryId: 'platform',
      },
    };

    const result = await createProject(body);

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(result.name).toBe('Platform');
    expect(result.slug).toBe('platform');
    expect(request.url).toBe('https://api.example.test/projects');
    expect(request.method).toBe('POST');
    expect(requestBody).toEqual({
      workspace_id: body.workspaceId,
      name: body.name,
      slug: body.slug,
      source: {
        connection_id: body.source.connectionId,
        external_repository_id: body.source.externalRepositoryId,
      },
    });
  });
});
