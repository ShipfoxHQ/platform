import {Buffer} from 'node:buffer';
import {GiteaIntegrationProviderError} from '#core/errors.js';
import {createGiteaApiClient} from './client.js';

const REPOSITORY = {
  id: 7,
  owner: {login: 'shipfox'},
  name: 'platform',
  full_name: 'shipfox/platform',
  default_branch: 'main',
  private: true,
  clone_url: 'https://gitea.example.com/shipfox/platform.git',
  html_url: 'https://gitea.example.com/shipfox/platform',
};

function jsonResponse(
  body: unknown,
  init: {status?: number; headers?: Record<string, string>} = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {'content-type': 'application/json', ...init.headers},
  });
}

describe('HttpGiteaApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestedUrl(call = 0): URL {
    return new URL(String(fetchMock.mock.calls[call]?.[0]));
  }

  function requestInit(call = 0): RequestInit {
    return fetchMock.mock.calls[call]?.[1] as RequestInit;
  }

  it('lists org repositories with basic auth and a page cursor from the link header', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse([REPOSITORY], {
        headers: {
          link: '<https://gitea.example.com/api/v1/orgs/shipfox/repos?page=3&limit=50>; rel="next"',
        },
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.listOrgRepositories({org: 'shipfox', limit: 50, cursor: '2'});

    expect(result.repositories[0]?.fullName).toBe('shipfox/platform');
    expect(result.nextCursor).toBe('3');
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/orgs/shipfox/repos');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('50');
    expect((requestInit().headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('shipfox-bot:test-service-token').toString('base64')}`,
    );
  });

  it('returns no next cursor when the link header has no next relation', async () => {
    fetchMock.mockResolvedValue(jsonResponse([REPOSITORY]));
    const client = createGiteaApiClient();

    const result = await client.listOrgRepositories({org: 'shipfox', limit: 50});

    expect(result.nextCursor).toBeNull();
  });

  it('gets a single repository', async () => {
    fetchMock.mockResolvedValue(jsonResponse(REPOSITORY));
    const client = createGiteaApiClient();

    const result = await client.getRepository({owner: 'shipfox', repo: 'platform'});

    expect(result).toEqual({
      ownerLogin: 'shipfox',
      name: 'platform',
      fullName: 'shipfox/platform',
      defaultBranch: 'main',
      private: true,
      cloneUrl: 'https://gitea.example.com/shipfox/platform.git',
      htmlUrl: 'https://gitea.example.com/shipfox/platform',
    });
    expect(requestedUrl().pathname).toBe('/api/v1/repos/shipfox/platform');
  });

  it('resolves a ref to its head commit sha', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{sha: 'abc123'}, {sha: 'older'}]));
    const client = createGiteaApiClient();

    const sha = await client.resolveRef({owner: 'shipfox', repo: 'platform', ref: 'main'});

    expect(sha).toBe('abc123');
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/commits');
    expect(url.searchParams.get('sha')).toBe('main');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('rejects a ref that resolves to no commit', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    const client = createGiteaApiClient();

    const result = client.resolveRef({owner: 'shipfox', repo: 'platform', ref: 'missing'});

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('gets a branch head commit', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({name: 'main', commit: {id: 'abc123', message: 'hi'}}),
    );
    const client = createGiteaApiClient();

    const result = await client.getBranch({owner: 'shipfox', repo: 'platform', branch: 'main'});

    expect(result).toEqual({commitSha: 'abc123'});
    expect(requestedUrl().pathname).toBe('/api/v1/repos/shipfox/platform/branches/main');
  });

  it('gets a tag head commit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({name: 'v1.0.0', commit: {sha: 'abc123'}}));
    const client = createGiteaApiClient();

    const result = await client.getTag({owner: 'shipfox', repo: 'platform', tag: 'v1.0.0'});

    expect(result).toEqual({commitSha: 'abc123'});
    expect(requestedUrl().pathname).toBe('/api/v1/repos/shipfox/platform/tags/v1.0.0');
  });

  it('maps a missing branch to ref-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({message: 'not found'}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.getBranch({owner: 'shipfox', repo: 'platform', branch: 'missing'});

    await expect(result).rejects.toMatchObject({reason: 'ref-not-found'});
  });

  it('maps a missing tag to ref-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({message: 'not found'}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.getTag({owner: 'shipfox', repo: 'platform', tag: 'missing'});

    await expect(result).rejects.toMatchObject({reason: 'ref-not-found'});
  });

  it('rejects a branch response without a head commit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({name: 'main', commit: {}}));
    const client = createGiteaApiClient();

    const result = client.getBranch({owner: 'shipfox', repo: 'platform', branch: 'main'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('rejects a tag response without a head commit', async () => {
    fetchMock.mockResolvedValue(jsonResponse({name: 'v1.0.0', commit: {}}));
    const client = createGiteaApiClient();

    const result = client.getTag({owner: 'shipfox', repo: 'platform', tag: 'v1.0.0'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('lists the recursive tree, keeping blobs and dropping subtrees', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        tree: [
          {path: 'README.md', type: 'blob', size: 12},
          {path: 'src', type: 'tree'},
          {path: 'src/index.ts', type: 'blob', size: 34},
        ],
        truncated: false,
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.listTree({owner: 'shipfox', repo: 'platform', sha: 'abc123'});

    expect(result.blobs).toEqual([
      {path: 'README.md', size: 12},
      {path: 'src/index.ts', size: 34},
    ]);
    expect(result.truncated).toBe(false);
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/git/trees/abc123');
    expect(url.searchParams.get('recursive')).toBe('true');
  });

  it('reports a truncated tree', async () => {
    fetchMock.mockResolvedValue(jsonResponse({tree: [], truncated: true}));
    const client = createGiteaApiClient();

    const result = await client.listTree({owner: 'shipfox', repo: 'platform', sha: 'abc123'});

    expect(result.truncated).toBe(true);
  });

  it('fetches and base64-decodes file content', async () => {
    const content = 'name: CI\n';
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: 'file',
        encoding: 'base64',
        path: '.shipfox/workflows/ci.yml',
        size: content.length,
        content: Buffer.from(content).toString('base64'),
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: '.shipfox/workflows/ci.yml',
      ref: 'main',
    });

    expect(result.content).toBe(content);
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/contents/.shipfox/workflows/ci.yml');
    expect(url.searchParams.get('ref')).toBe('main');
  });

  it('rejects a content response that is a directory listing', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{type: 'file', path: 'a'}]));
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'src',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
  });

  it('rejects file content larger than the supported limit before decoding', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        type: 'file',
        encoding: 'base64',
        path: 'big.bin',
        size: 1_000_001,
        content: '',
      }),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'big.bin',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'content-too-large'});
  });

  it.each([
    [401, 'access-denied'],
    [403, 'access-denied'],
    [404, 'repository-not-found'],
    [429, 'rate-limited'],
    [500, 'provider-unavailable'],
    [503, 'provider-unavailable'],
  ])('maps HTTP %s to the %s reason', async (status, reason) => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toBeInstanceOf(GiteaIntegrationProviderError);
    await expect(result).rejects.toMatchObject({reason});
  });

  it('carries retry-after seconds on a rate-limited response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 429, headers: {'retry-after': '42'}}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 42});
  });

  it('treats an exhausted rate-limit budget on a 403 as rate-limited', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({}, {status: 403, headers: {'x-ratelimit-remaining': '0'}}),
    );
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'rate-limited'});
  });

  it('maps a network failure to provider-unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'provider-unavailable'});
  });

  it('maps a malformed repository payload to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({name: 'platform'}));
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a file response without base64 content to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({type: 'file', encoding: 'utf-8', path: 'a', size: 1, content: 'x'}),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'a',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a file response missing a numeric size to malformed-provider-response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({type: 'file', encoding: 'base64', path: 'a', content: ''}),
    );
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'a',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('maps a 404 on the contents endpoint to file-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: 'missing.txt',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
  });

  it('rejects a path with traversal segments before issuing a request', async () => {
    const client = createGiteaApiClient();

    const result = client.fetchFileContent({
      owner: 'shipfox',
      repo: 'platform',
      path: '../../../../user/keys',
      ref: 'main',
    });

    await expect(result).rejects.toMatchObject({reason: 'file-not-found'});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a request timeout to the timeout reason', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error('The operation timed out'), {name: 'TimeoutError'}),
    );
    const client = createGiteaApiClient();

    const result = client.getRepository({owner: 'shipfox', repo: 'platform'});

    await expect(result).rejects.toMatchObject({reason: 'timeout'});
  });

  it('reports an existing organization as present', async () => {
    fetchMock.mockResolvedValue(jsonResponse({username: 'shipfox'}));
    const client = createGiteaApiClient();

    const exists = await client.organizationExists({org: 'shipfox'});

    expect(exists).toBe(true);
    expect(requestedUrl().pathname).toBe('/api/v1/orgs/shipfox');
  });

  it('reports a missing organization as absent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 404}));
    const client = createGiteaApiClient();

    const exists = await client.organizationExists({org: 'ghost'});

    expect(exists).toBe(false);
  });

  it('surfaces a non-404 error while checking an organization', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, {status: 403}));
    const client = createGiteaApiClient();

    const result = client.organizationExists({org: 'shipfox'});

    await expect(result).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('gets an issue and maps its fields to camelCase', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 7,
        number: 3,
        title: 'Broken checkout',
        body: 'The checkout step times out.',
        state: 'open',
        comments: 2,
        html_url: 'https://gitea.example.com/shipfox/platform/issues/3',
        created_at: '2026-01-02T03:04:05Z',
        updated_at: '2026-01-03T04:05:06Z',
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.getIssue({owner: 'shipfox', repo: 'platform', index: 3});

    expect(result).toEqual({
      id: 7,
      number: 3,
      title: 'Broken checkout',
      body: 'The checkout step times out.',
      state: 'open',
      comments: 2,
      htmlUrl: 'https://gitea.example.com/shipfox/platform/issues/3',
      createdAt: '2026-01-02T03:04:05Z',
      updatedAt: '2026-01-03T04:05:06Z',
    });
    expect(requestedUrl().pathname).toBe('/api/v1/repos/shipfox/platform/issues/3');
  });

  it('maps a missing issue to repository-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({message: 'not found'}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.getIssue({owner: 'shipfox', repo: 'platform', index: 99});

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('rejects an issue response missing required fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({id: 7, title: 'Broken checkout'}));
    const client = createGiteaApiClient();

    const result = client.getIssue({owner: 'shipfox', repo: 'platform', index: 3});

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });

  it('creates an issue comment with a JSON body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 11,
        html_url: 'https://gitea.example.com/shipfox/platform/issues/3#issuecomment-11',
        body: 'Fixed in the next release.',
        created_at: '2026-01-04T05:06:07Z',
        updated_at: '2026-01-04T05:06:07Z',
      }),
    );
    const client = createGiteaApiClient();

    const result = await client.createIssueComment({
      owner: 'shipfox',
      repo: 'platform',
      index: 3,
      body: 'Fixed in the next release.',
    });

    expect(result).toEqual({
      id: 11,
      htmlUrl: 'https://gitea.example.com/shipfox/platform/issues/3#issuecomment-11',
      body: 'Fixed in the next release.',
      createdAt: '2026-01-04T05:06:07Z',
      updatedAt: '2026-01-04T05:06:07Z',
    });
    const url = requestedUrl();
    expect(url.pathname).toBe('/api/v1/repos/shipfox/platform/issues/3/comments');
    expect(requestInit().method).toBe('POST');
    expect((requestInit().headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
    expect(requestInit().body).toBe(JSON.stringify({body: 'Fixed in the next release.'}));
  });

  it('maps a missing comment target to repository-not-found', async () => {
    fetchMock.mockResolvedValue(jsonResponse({message: 'not found'}, {status: 404}));
    const client = createGiteaApiClient();

    const result = client.createIssueComment({
      owner: 'shipfox',
      repo: 'platform',
      index: 99,
      body: 'Hello',
    });

    await expect(result).rejects.toMatchObject({reason: 'repository-not-found'});
  });

  it('rejects a comment response missing required fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse({id: 11, body: 'Hello'}));
    const client = createGiteaApiClient();

    const result = client.createIssueComment({
      owner: 'shipfox',
      repo: 'platform',
      index: 3,
      body: 'Hello',
    });

    await expect(result).rejects.toMatchObject({reason: 'malformed-provider-response'});
  });
});
