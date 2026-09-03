import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

const JWT_SEGMENT_LENGTH = 169;

export const GITHUB_STATELESS_INSTALLATION_TOKEN =
  `ghs_123456_${'a'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'b'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'c'.repeat(JWT_SEGMENT_LENGTH)}`;
export const GITHUB_STATEFUL_INSTALLATION_TOKEN = `ghs_${'d'.repeat(36)}`;
export const GITHUB_READ_RESULT_MARKER = 'github-read-result-marker';
export const GITHUB_WRITE_RESULT_MARKER = 'github-write-result-marker';
export const GITHUB_SEARCH_RESULT_MARKER = 'github-search-result-marker';
export const GITHUB_GRAPHQL_RESULT_MARKER = 'github-graphql-result-marker';

const INSTALLATION_TOKEN_PATH = /^\/app\/installations\/(\d+)\/access_tokens$/u;
const REPOSITORY_PATH = /^\/repositories\/(\d+)$/u;
const ISSUE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u;
const ISSUES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues$/u;
const SEARCH_ISSUES_PATH = /^\/search\/issues$/u;
const GRAPHQL_PATH = /^\/graphql$/u;

export type GithubApiMockCall =
  | {
      kind: 'mint-token';
      authorization: string | undefined;
      tokenFormatOverride: string | undefined;
      installationId: number;
      body: Record<string, unknown>;
    }
  | {
      kind: 'resolve-repository';
      authorization: string | undefined;
      repositoryId: number;
    }
  | {
      kind: 'search-issues';
      authorization: string | undefined;
      query: string | null;
    }
  | {
      kind: 'graphql';
      authorization: string | undefined;
      query: string;
      variables: Record<string, unknown>;
    }
  | {
      kind: 'read-issue';
      authorization: string | undefined;
      owner: string;
      repo: string;
      issueNumber: number;
    }
  | {
      kind: 'create-issue';
      authorization: string | undefined;
      owner: string;
      repo: string;
      body: Record<string, unknown>;
    };

export interface GithubApiMock {
  calls: GithubApiMockCall[];
  endpoint: URL;
  stop(): Promise<void>;
}

export interface GithubApiMockOptions {
  endpoint?: URL | undefined;
  installationId?: number | undefined;
  installationToken?: string | undefined;
}

export async function startGithubApiMock(
  options: GithubApiMockOptions = {},
): Promise<GithubApiMock> {
  const calls: GithubApiMockCall[] = [];
  const installationId = options.installationId;
  const installationToken = options.installationToken ?? GITHUB_STATELESS_INSTALLATION_TOKEN;
  const endpoint = options.endpoint ?? new URL(requiredGithubApiBaseUrl());
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleGithubRequest({
      calls,
      endpoint: boundEndpoint,
      installationId,
      installationToken,
      request,
      response,
    });
  });

  try {
    boundEndpoint = await listen(server, endpoint);
  } catch (error) {
    throw new Error(`GitHub API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    stop: async () => {
      try {
        await close(server);
      } catch (error) {
        throw new Error(`GitHub API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

interface GithubRequestContext {
  calls: GithubApiMockCall[];
  endpoint: URL;
  installationId: number | undefined;
  installationToken: string;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  authorization: string | undefined;
}

async function handleGithubRequest(params: {
  calls: GithubApiMockCall[];
  endpoint: URL;
  installationId: number | undefined;
  installationToken: string;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const context: GithubRequestContext = {
    ...params,
    requestUrl,
    authorization: params.request.headers.authorization,
  };
  const mintMatch = requestUrl.pathname.match(INSTALLATION_TOKEN_PATH);
  if (requestMatches(params.request, 'POST', mintMatch)) {
    await handleMintRequest(context, mintMatch);
    return;
  }
  const repositoryMatch = requestUrl.pathname.match(REPOSITORY_PATH);
  if (requestMatches(params.request, 'GET', repositoryMatch)) {
    handleRepositoryRequest(context, repositoryMatch);
    return;
  }
  const issueMatch = requestUrl.pathname.match(ISSUE_PATH);
  if (requestMatches(params.request, 'GET', issueMatch)) {
    handleIssueRequest(context, issueMatch);
    return;
  }
  const createIssueMatch = requestUrl.pathname.match(ISSUES_PATH);
  if (requestMatches(params.request, 'POST', createIssueMatch)) {
    await handleCreateIssueRequest(context, createIssueMatch);
    return;
  }
  const searchIssuesMatch = requestUrl.pathname.match(SEARCH_ISSUES_PATH);
  if (requestMatches(params.request, 'GET', searchIssuesMatch)) {
    handleSearchIssuesRequest(context);
    return;
  }
  const graphqlMatch = requestUrl.pathname.match(GRAPHQL_PATH);
  if (requestMatches(params.request, 'POST', graphqlMatch)) {
    await handleGraphqlRequest(context);
    return;
  }

  sendJson(params.response, 404, {message: 'Not Found'});
}

function requestMatches(
  request: IncomingMessage,
  method: string,
  match: RegExpMatchArray | null,
): match is RegExpMatchArray {
  return request.method === method && match !== null;
}

async function handleMintRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBody(params.request);
  const installationId = Number(match[1]);
  if (params.installationId !== undefined && params.installationId !== installationId) {
    sendJson(params.response, 404, {message: 'Not Found'});
    return;
  }
  params.calls.push({
    kind: 'mint-token',
    authorization: params.authorization,
    tokenFormatOverride: singleHeader(params.request.headers['x-github-stateless-s2s-token']),
    installationId,
    body,
  });
  const repositories = scopedRepositories(body, params.endpoint);
  sendJson(params.response, 201, {
    token: params.installationToken,
    expires_at: '2099-01-01T00:00:00.000Z',
    permissions: permissionsFromMint(body),
    repository_selection: 'all',
    ...(repositories === undefined ? {} : {repositories}),
  });
}

function handleRepositoryRequest(params: GithubRequestContext, match: RegExpMatchArray): void {
  const repositoryId = Number(match[1]);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'resolve-repository',
      authorization: params.authorization,
      repositoryId,
    });
  }
  sendJson(params.response, 200, repositoryPayload(repositoryId, params.endpoint));
}

function handleIssueRequest(params: GithubRequestContext, match: RegExpMatchArray): void {
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'read-issue',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      issueNumber: Number(match[3]),
    });
  }
  sendJson(params.response, 200, {
    number: Number(match[3]),
    title: 'Synthetic GitHub issue',
    marker: GITHUB_READ_RESULT_MARKER,
  });
}

async function handleCreateIssueRequest(
  params: GithubRequestContext,
  match: RegExpMatchArray,
): Promise<void> {
  const body = await readJsonBody(params.request);
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'create-issue',
      authorization: params.authorization,
      owner: decodeURIComponent(match[1] ?? ''),
      repo: decodeURIComponent(match[2] ?? ''),
      body,
    });
  }
  sendJson(params.response, 201, {
    number: 2,
    marker: GITHUB_WRITE_RESULT_MARKER,
  });
}

function handleSearchIssuesRequest(params: GithubRequestContext): void {
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({
      kind: 'search-issues',
      authorization: params.authorization,
      query: params.requestUrl.searchParams.get('q'),
    });
  }
  sendJson(params.response, 200, {
    total_count: 1,
    incomplete_results: false,
    items: [{marker: GITHUB_SEARCH_RESULT_MARKER}],
  });
}

async function handleGraphqlRequest(params: GithubRequestContext): Promise<void> {
  const body = await readJsonBody(params.request);
  const query = typeof body.query === 'string' ? body.query : '';
  const variables = isRecord(body.variables) ? body.variables : {};
  if (isCurrentInstallationAuthorization(params)) {
    params.calls.push({kind: 'graphql', authorization: params.authorization, query, variables});
  }
  sendJson(params.response, 200, {
    data: {
      resolveReviewThread: {
        thread: {
          id: isRecord(variables.input) ? variables.input.threadId : 'synthetic-thread-id',
          isResolved: true,
          marker: GITHUB_GRAPHQL_RESULT_MARKER,
        },
      },
    },
  });
}

function isCurrentInstallationAuthorization(params: GithubRequestContext): boolean {
  if (params.installationId === undefined) return true;
  return (
    params.authorization === `bearer ${params.installationToken}` ||
    params.authorization === `token ${params.installationToken}`
  );
}

function permissionsFromMint(body: Record<string, unknown>): Record<string, string> {
  return isRecord(body.permissions)
    ? (body.permissions as Record<string, string>)
    : {issues: 'write'};
}

function scopedRepositories(
  body: Record<string, unknown>,
  endpoint: URL,
): Record<string, unknown>[] | undefined {
  if (Array.isArray(body.repository_ids)) {
    return body.repository_ids
      .filter((value): value is number => typeof value === 'number')
      .map((repositoryId) => repositoryPayload(repositoryId, endpoint));
  }
  if (Array.isArray(body.repositories)) {
    return body.repositories
      .filter((value): value is string => typeof value === 'string')
      .map((repositoryName) => {
        const [ownerPart, namePart] = repositoryName.split('/', 2);
        const owner = namePart === undefined ? 'shipfox' : ownerPart;
        const name = namePart ?? ownerPart;
        return repositoryPayload(
          owner === 'shipfox' && name === 'e2e' ? 42 : 43,
          endpoint,
          owner,
          name,
        );
      });
  }
  return undefined;
}

function repositoryPayload(
  repositoryId: number,
  endpoint: URL,
  owner = 'shipfox',
  name = repositoryId === 42 ? 'e2e' : 'outside',
): Record<string, unknown> {
  return {
    id: repositoryId,
    owner: {login: owner},
    name,
    full_name: `${owner}/${name}`,
    default_branch: 'main',
    private: true,
    visibility: 'private',
    clone_url: new URL(`/repos/${owner}/${name}.git`, endpoint).toString(),
    html_url: `https://github.com/${owner}/${name}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function requiredGithubApiBaseUrl(): string {
  const endpoint = process.env.GITHUB_API_BASE_URL;
  if (!endpoint) throw new Error('GITHUB_API_BASE_URL must be configured for the GitHub API mock.');
  return endpoint;
}

async function listen(server: HttpServer, endpoint: URL): Promise<URL> {
  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);
  return boundEndpoint;
}

async function close(server: HttpServer): Promise<void> {
  server.close();
  await once(server, 'close');
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
