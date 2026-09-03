import {
  GITHUB_GRAPHQL_RESULT_MARKER,
  GITHUB_READ_RESULT_MARKER,
  GITHUB_SEARCH_RESULT_MARKER,
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
  GITHUB_WRITE_RESULT_MARKER,
  startGithubApiMock,
} from './github-api.js';

const GITHUB_INSTALLATION_TOKEN_PATTERN = /^ghs_[A-Za-z0-9._-]{36,}$/u;

describe('GitHub API mock', () => {
  it.each([
    {
      format: 'stateless',
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
    },
    {
      format: 'stateful',
      token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
      authorization: `token ${GITHUB_STATEFUL_INSTALLATION_TOKEN}`,
    },
  ])('serves $format installation-token and issue requests', async ({token, authorization}) => {
    const mock = await startGithubApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      installationToken: token,
    });

    try {
      const mint = await fetch(new URL('/app/installations/1234/access_tokens', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization: 'Bearer app-jwt',
          'content-type': 'application/json',
          'x-github-stateless-s2s-token': 'enabled',
        },
        body: '{}',
      });
      const read = await fetch(new URL('/repos/shipfox/e2e/issues/1', mock.endpoint), {
        headers: {authorization},
      });
      const write = await fetch(new URL('/repos/shipfox/e2e/issues', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify({title: 'Synthetic issue'}),
      });

      expect(mint.status).toBe(201);
      expect(token).toMatch(GITHUB_INSTALLATION_TOKEN_PATTERN);
      await expect(mint.json()).resolves.toMatchObject({
        token,
        permissions: {issues: 'write'},
      });
      await expect(read.json()).resolves.toMatchObject({marker: GITHUB_READ_RESULT_MARKER});
      await expect(write.json()).resolves.toMatchObject({marker: GITHUB_WRITE_RESULT_MARKER});
      expect(mock.calls).toEqual([
        {
          kind: 'mint-token',
          authorization: 'Bearer app-jwt',
          tokenFormatOverride: 'enabled',
          installationId: 1234,
          body: {},
        },
        {
          kind: 'read-issue',
          authorization,
          owner: 'shipfox',
          repo: 'e2e',
          issueNumber: 1,
        },
        {
          kind: 'create-issue',
          authorization,
          owner: 'shipfox',
          repo: 'e2e',
          body: {title: 'Synthetic issue'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('serves repository metadata, scoped checkout mints, search, and GraphQL requests', async () => {
    const mock = await startGithubApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const mint = await fetch(new URL('/app/installations/1234/access_tokens', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization: 'Bearer app-jwt',
          'content-type': 'application/json',
          'x-github-stateless-s2s-token': 'enabled',
        },
        body: JSON.stringify({repository_ids: [42], permissions: {contents: 'read'}}),
      });
      const repository = await fetch(new URL('/repositories/42', mock.endpoint), {
        headers: {authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`},
      });
      const search = await fetch(
        new URL('/search/issues?q=is%3Aopen%20repo%3Ashipfox%2Fe2e', mock.endpoint),
        {headers: {authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`}},
      );
      const graphql = await fetch(new URL('/graphql', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: 'mutation ResolveReviewThread { resolveReviewThread { thread { id } } }',
          variables: {input: {threadId: 'thread-42'}},
        }),
      });

      expect(mint.status).toBe(201);
      expect(repository.status).toBe(200);
      expect(search.status).toBe(200);
      expect(graphql.status).toBe(200);
      await expect(mint.json()).resolves.toMatchObject({
        repositories: [{id: 42, full_name: 'shipfox/e2e'}],
      });
      await expect(repository.json()).resolves.toMatchObject({id: 42, full_name: 'shipfox/e2e'});
      await expect(search.json()).resolves.toMatchObject({
        items: [{marker: GITHUB_SEARCH_RESULT_MARKER}],
      });
      await expect(graphql.json()).resolves.toMatchObject({
        data: {
          resolveReviewThread: {
            thread: {id: 'thread-42', marker: GITHUB_GRAPHQL_RESULT_MARKER},
          },
        },
      });
      expect(mock.calls).toEqual([
        {
          kind: 'mint-token',
          authorization: 'Bearer app-jwt',
          tokenFormatOverride: 'enabled',
          installationId: 1234,
          body: {repository_ids: [42], permissions: {contents: 'read'}},
        },
        {
          kind: 'resolve-repository',
          authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
          repositoryId: 42,
        },
        {
          kind: 'search-issues',
          authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
          query: 'is:open repo:shipfox/e2e',
        },
        {
          kind: 'graphql',
          authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
          query: 'mutation ResolveReviewThread { resolveReviewThread { thread { id } } }',
          variables: {input: {threadId: 'thread-42'}},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });
});
