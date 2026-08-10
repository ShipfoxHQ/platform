import {
  GITHUB_INSTALLATION_TOKEN,
  GITHUB_READ_RESULT_MARKER,
  GITHUB_WRITE_RESULT_MARKER,
  startGithubApiMock,
} from './github-api.js';

describe('GitHub API mock', () => {
  it('serves installation-token, issue-read, and issue-write requests', async () => {
    const mock = await startGithubApiMock(new URL('http://127.0.0.1:0'));

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
        headers: {authorization: `token ${GITHUB_INSTALLATION_TOKEN}`},
      });
      const write = await fetch(new URL('/repos/shipfox/e2e/issues', mock.endpoint), {
        method: 'POST',
        headers: {
          authorization: `token ${GITHUB_INSTALLATION_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({title: 'Synthetic issue'}),
      });

      expect(mint.status).toBe(201);
      expect(GITHUB_INSTALLATION_TOKEN).toHaveLength(520);
      await expect(mint.json()).resolves.toMatchObject({
        token: GITHUB_INSTALLATION_TOKEN,
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
          authorization: `token ${GITHUB_INSTALLATION_TOKEN}`,
          owner: 'shipfox',
          repo: 'e2e',
          issueNumber: 1,
        },
        {
          kind: 'create-issue',
          authorization: `token ${GITHUB_INSTALLATION_TOKEN}`,
          owner: 'shipfox',
          repo: 'e2e',
          body: {title: 'Synthetic issue'},
        },
      ]);
    } finally {
      await mock.stop();
    }
  });
});
