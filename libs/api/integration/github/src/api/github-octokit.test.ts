import {generateKeyPairSync} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {App, Octokit} from 'octokit';
import {
  GITHUB_STATEFUL_INSTALLATION_TOKEN,
  GITHUB_STATELESS_INSTALLATION_TOKEN,
} from '#test/index.js';
import {
  createGithubInstallationTokenFormatPlugin,
  getGithubInstallationOctokit,
} from './github-octokit.js';

const {privateKey} = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {type: 'spki', format: 'pem'},
  privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
});
const BEARER_AUTHORIZATION = /^bearer /iu;

describe('GitHub installation Octokit', () => {
  it.each([
    {
      format: 'stateless',
      token: GITHUB_STATELESS_INSTALLATION_TOKEN,
      override: 'enabled' as const,
      authorization: `bearer ${GITHUB_STATELESS_INSTALLATION_TOKEN}`,
    },
    {
      format: 'stateful',
      token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
      override: 'disabled' as const,
      authorization: `token ${GITHUB_STATEFUL_INSTALLATION_TOKEN}`,
    },
    {
      format: 'stateful without an override',
      token: GITHUB_STATEFUL_INSTALLATION_TOKEN,
      override: undefined,
      authorization: `token ${GITHUB_STATEFUL_INSTALLATION_TOKEN}`,
    },
  ])('requests and authenticates with a $format token', async ({
    token,
    override,
    authorization,
  }) => {
    const calls: Array<{
      method: string | undefined;
      path: string | undefined;
      authorization: string | undefined;
      tokenFormatOverride: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      calls.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        tokenFormatOverride: request.headers['x-github-stateless-s2s-token'] as string | undefined,
      });

      if (request.method === 'POST' && request.url === '/app/installations/123/access_tokens') {
        response.writeHead(201, {'content-type': 'application/json'}).end(
          JSON.stringify({
            token,
            expires_at: '2099-01-01T00:00:00.000Z',
            permissions: {metadata: 'read'},
            repository_selection: 'all',
          }),
        );
        return;
      }

      if (request.method === 'GET' && request.url === '/installation/repositories') {
        response
          .writeHead(200, {'content-type': 'application/json'})
          .end(JSON.stringify({total_count: 0, repositories: []}));
        return;
      }

      response.writeHead(404, {'content-type': 'application/json'}).end('{"message":"Not Found"}');
    });
    server.listen({host: '127.0.0.1', port: 0});
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const InstallationTokenOctokit = Octokit.plugin(
        createGithubInstallationTokenFormatPlugin(override),
      ).defaults({baseUrl});
      const app = new App({appId: 1, privateKey, Octokit: InstallationTokenOctokit});
      const octokit = await getGithubInstallationOctokit(app, 123, baseUrl);

      await octokit.rest.apps.listReposAccessibleToInstallation();

      expect(calls).toEqual([
        {
          method: 'POST',
          path: '/app/installations/123/access_tokens',
          authorization: expect.stringMatching(BEARER_AUTHORIZATION),
          tokenFormatOverride: override,
        },
        {
          method: 'GET',
          path: '/installation/repositories',
          authorization,
          tokenFormatOverride: undefined,
        },
      ]);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
