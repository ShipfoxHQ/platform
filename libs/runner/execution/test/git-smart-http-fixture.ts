import {spawn} from 'node:child_process';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {basename, dirname} from 'node:path';

export type GitHttpCredentialGeneration = string | number;

export interface GitHttpCredential {
  generation: GitHttpCredentialGeneration;
  username: string;
  token: string;
  accepted: boolean;
}

export interface GitSmartHttpFixtureOptions {
  repositoryPath: string;
  credentials: GitHttpCredential[];
  realm?: string;
}

export interface GitSmartHttpRequest {
  method: string;
  path: string;
  authorization?: string;
}

export interface GitSmartHttpFixture {
  readonly url: string;
  readonly requestCount: number;
  readonly authorizationHeaders: readonly (string | undefined)[];
  readonly requests: readonly GitSmartHttpRequest[];
  start(): Promise<void>;
  close(): Promise<void>;
  setGeneration(generation: GitHttpCredentialGeneration): void;
}

/**
 * A real git smart-HTTP endpoint for runner tests. Authentication is deliberately
 * handled before git-http-backend so rejected credentials receive the same challenge
 * Git sees from a provider, rather than a mocked fetch response.
 */
export function createGitSmartHttpFixture(
  options: GitSmartHttpFixtureOptions,
): GitSmartHttpFixture {
  const credentials = new Map(
    options.credentials.map((credential) => [credential.generation, credential]),
  );
  const realm = options.realm ?? 'shipfox-test-git';
  const requests: GitSmartHttpRequest[] = [];
  let generation = options.credentials.find((credential) => credential.accepted)?.generation;
  let server: Server | undefined;
  let address: string | undefined;

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const authorization = request.headers.authorization;
    requests.push({
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      ...(authorization === undefined ? {} : {authorization}),
    });

    const credential = findCredential(credentials, authorization);
    if (credential === undefined || credential.generation !== generation || !credential.accepted) {
      response.writeHead(401, {'www-authenticate': `Basic realm="${realm}"`});
      response.end();
      return;
    }

    await proxyToGitHttpBackend(request, response, options.repositoryPath);
  };

  return {
    get url() {
      if (address === undefined) throw new Error('Git smart-HTTP fixture is not started');
      return `${address}/${basename(options.repositoryPath)}`;
    },
    get requestCount() {
      return requests.length;
    },
    get authorizationHeaders() {
      return requests.map((request) => request.authorization);
    },
    get requests() {
      return [...requests];
    },
    async start() {
      if (server !== undefined) return;
      server = createServer((request, response) => {
        void handler(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      });
      await listen(server);
      const serverAddress = server.address();
      if (serverAddress === null || typeof serverAddress === 'string') {
        throw new Error('Git smart-HTTP fixture did not expose a TCP address');
      }
      address = `http://127.0.0.1:${serverAddress.port}`;
    },
    async close() {
      if (server === undefined) return;
      const currentServer = server;
      server = undefined;
      address = undefined;
      await new Promise<void>((resolve, reject) => {
        currentServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
    setGeneration(nextGeneration) {
      if (!credentials.has(nextGeneration)) {
        throw new Error(`Unknown Git credential generation: ${String(nextGeneration)}`);
      }
      generation = nextGeneration;
    },
  };
}

function findCredential(
  credentials: Map<GitHttpCredentialGeneration, GitHttpCredential>,
  authorization: string | undefined,
): GitHttpCredential | undefined {
  if (authorization?.startsWith('Basic ') !== true) return undefined;
  const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return undefined;
  return [...credentials.values()].find(
    (credential) =>
      credential.username === decoded.slice(0, separator) &&
      credential.token === decoded.slice(separator + 1),
  );
}

async function proxyToGitHttpBackend(
  request: IncomingMessage,
  response: ServerResponse,
  repositoryPath: string,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://fixture.invalid');
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: dirname(repositoryPath),
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: requestUrl.pathname,
      QUERY_STRING: requestUrl.search.slice(1),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: request.headers['content-type'] ?? '',
      CONTENT_LENGTH: request.headers['content-length'] ?? '',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const output = collect(child.stdout);
  const error = collect(child.stderr);
  request.pipe(child.stdin);
  const [body, errorOutput, exitCode] = await Promise.all([output, error, waitForExit(child)]);
  if (exitCode !== 0) throw new Error(`git-http-backend failed: ${errorOutput.toString('utf8')}`);

  const separator = body.indexOf(Buffer.from('\r\n\r\n'));
  if (separator < 0) throw new Error('git-http-backend returned malformed CGI headers');
  const headerText = body.subarray(0, separator).toString('utf8');
  const headers = new Map<string, string>();
  let status = 200;
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
    else headers.set(name, value);
  }
  response.writeHead(status, Object.fromEntries(headers));
  response.end(body.subarray(separator + 4));
}

function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}
