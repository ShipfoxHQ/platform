import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

const JWT_SEGMENT_LENGTH = 169;

export const GITHUB_INSTALLATION_TOKEN =
  `ghs_123456_${'a'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'b'.repeat(JWT_SEGMENT_LENGTH)}` +
  `.${'c'.repeat(JWT_SEGMENT_LENGTH)}`;
export const GITHUB_READ_RESULT_MARKER = 'github-read-result-marker';
export const GITHUB_WRITE_RESULT_MARKER = 'github-write-result-marker';

const INSTALLATION_TOKEN_PATH = /^\/app\/installations\/(\d+)\/access_tokens$/u;
const ISSUE_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/u;
const ISSUES_PATH = /^\/repos\/([^/]+)\/([^/]+)\/issues$/u;

export type GithubApiMockCall =
  | {
      kind: 'mint-token';
      authorization: string | undefined;
      tokenFormatOverride: string | undefined;
      installationId: number;
      body: Record<string, unknown>;
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

export async function startGithubApiMock(
  endpoint = new URL(requiredGithubApiBaseUrl()),
): Promise<GithubApiMock> {
  const calls: GithubApiMockCall[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleGithubRequest({calls, endpoint: boundEndpoint, request, response});
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

async function handleGithubRequest(params: {
  calls: GithubApiMockCall[];
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const authorization = params.request.headers.authorization;
  const mintMatch = requestUrl.pathname.match(INSTALLATION_TOKEN_PATH);
  const issueMatch = requestUrl.pathname.match(ISSUE_PATH);
  const createIssueMatch = requestUrl.pathname.match(ISSUES_PATH);

  if (params.request.method === 'POST' && mintMatch) {
    params.calls.push({
      kind: 'mint-token',
      authorization,
      tokenFormatOverride: singleHeader(params.request.headers['x-github-stateless-s2s-token']),
      installationId: Number(mintMatch[1]),
      body: await readJsonBody(params.request),
    });
    sendJson(params.response, 201, {
      token: GITHUB_INSTALLATION_TOKEN,
      expires_at: '2099-01-01T00:00:00.000Z',
      permissions: {issues: 'write'},
      repository_selection: 'all',
    });
    return;
  }

  if (params.request.method === 'GET' && issueMatch) {
    params.calls.push({
      kind: 'read-issue',
      authorization,
      owner: decodeURIComponent(issueMatch[1] ?? ''),
      repo: decodeURIComponent(issueMatch[2] ?? ''),
      issueNumber: Number(issueMatch[3]),
    });
    sendJson(params.response, 200, {
      number: Number(issueMatch[3]),
      title: 'Synthetic GitHub issue',
      marker: GITHUB_READ_RESULT_MARKER,
    });
    return;
  }

  if (params.request.method === 'POST' && createIssueMatch) {
    params.calls.push({
      kind: 'create-issue',
      authorization,
      owner: decodeURIComponent(createIssueMatch[1] ?? ''),
      repo: decodeURIComponent(createIssueMatch[2] ?? ''),
      body: await readJsonBody(params.request),
    });
    sendJson(params.response, 201, {
      number: 2,
      marker: GITHUB_WRITE_RESULT_MARKER,
    });
    return;
  }

  sendJson(params.response, 404, {message: 'Not Found'});
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
