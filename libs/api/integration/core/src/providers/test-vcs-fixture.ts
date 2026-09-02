import {type ChildProcess, execFile, spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {createServer as createHttpsServer, type Server} from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import {promisify} from 'node:util';
import type {
  CheckoutCredentialRenewal,
  CheckoutCredentials,
  CheckoutPermissions,
  FileEntry,
  FilePage,
  FileSnapshot,
  RepositoryPage,
  RepositorySnapshot,
  ResolvedRef,
} from '@shipfox/api-integration-spi';
import {isValidGitRefName, MAX_REPOSITORY_FILE_BYTES} from '@shipfox/api-integration-spi';
import type {ModuleService} from '@shipfox/node-module';

const execFileAsync = promisify(execFile);
const TEST_VCS_USERNAME = 'x-access-token';
const TEST_VCS_REALM = 'shipfox-test-vcs';
const GIT_BACKEND_TIMEOUT_MS = 60_000;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TEST_VCS_FILE_BYTES = MAX_REPOSITORY_FILE_BYTES * 2;
const REPOSITORY_PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const GIT_TREE_FIELD_PATTERN = /\s+/u;
const GIT_REPOSITORY_PATH_PATTERN = /^\/([^/]+)\/([^/]+)\.git(?:\/|$)/u;

export type TestVcsRenewalMode = 'refresh-at' | 'on-rejection';

export interface TestVcsFileInput {
  path: string;
  content: string;
}

export interface TestVcsCreateRepositoryInput {
  owner: string;
  name: string;
  defaultBranch?: string | undefined;
  files: readonly TestVcsFileInput[];
}

export interface TestVcsCommitFilesInput {
  owner: string;
  name: string;
  message: string;
  files: readonly TestVcsFileInput[];
}

export interface TestVcsCredentialInput {
  owner: string;
  name: string;
  permissions: CheckoutPermissions;
  renewalMode: TestVcsRenewalMode;
  ttlSeconds: number;
  rejectedGeneration?: string | undefined;
}

export interface TestVcsStats {
  mintCount: number;
  requestCount: number;
  acceptedRequestCount: number;
  rejectedRequestCount: number;
  generations: string[];
  requests: Array<{
    method: string;
    path: string;
    status: 'accepted' | 'rejected';
    generation?: string | undefined;
  }>;
}

export interface TestVcsFixture {
  start(): Promise<void>;
  close(): Promise<void>;
  createRepository(input: TestVcsCreateRepositoryInput): Promise<RepositorySnapshot>;
  commitFiles(input: TestVcsCommitFilesInput): Promise<string>;
  getRepository(owner: string, name: string): RepositorySnapshot | undefined;
  listRepositories(owner: string): RepositoryPage;
  listFiles(input: {
    owner: string;
    name: string;
    ref: string;
    prefix: string;
    limit: number;
    cursor?: string | undefined;
  }): Promise<FilePage>;
  fetchFile(input: {owner: string; name: string; ref: string; path: string}): Promise<FileSnapshot>;
  resolveRef(input: {owner: string; name: string; ref: string}): Promise<ResolvedRef>;
  issueCredential(input: TestVcsCredentialInput): CheckoutCredentials;
  stats(owner?: string): TestVcsStats;
}

interface RepositoryRecord {
  snapshot: RepositorySnapshot;
  barePath: string;
  seedPath: string;
}

interface CredentialRecord {
  owner: string;
  name: string;
  username: string;
  generation: string;
  token: string;
  permissions: CheckoutPermissions;
  expiresAt: number;
}

interface GitHttpRequest {
  method: string;
  path: string;
  status: 'accepted' | 'rejected';
  generation?: string | undefined;
  owner?: string | undefined;
}

export function createTestVcsFixture(options: {port: number}): TestVcsFixture {
  const repositories = new Map<string, RepositoryRecord>();
  const credentials = new Map<string, CredentialRecord>();
  const requests: GitHttpRequest[] = [];
  const children = new Set<ChildProcess>();
  const childExitPromises = new Map<ChildProcess, Promise<number>>();
  let rootPath: string | undefined;
  let server: Server | undefined;

  const fixture: TestVcsFixture = {
    async start() {
      if (server !== undefined) return;

      const root = await mkdtemp(join(tmpdir(), 'shipfox-test-vcs-'));
      const keyPath = join(root, 'key.pem');
      const certificatePath = join(root, 'certificate.pem');
      try {
        await createCertificate(keyPath, certificatePath);
        const nextServer = createHttpsServer(
          {
            key: await readFile(keyPath),
            cert: await readFile(certificatePath),
          },
          (request, response) => {
            void handleGitRequest(request, response).catch(() => {
              if (!response.headersSent) response.writeHead(500);
              response.end();
            });
          },
        );
        await listen(nextServer, options.port);
        rootPath = root;
        server = nextServer;
      } catch (error) {
        await rm(root, {recursive: true, force: true});
        throw error;
      }
    },

    async close() {
      const currentServer = server;
      server = undefined;
      currentServer?.closeAllConnections();
      for (const child of children) child.kill();
      await Promise.allSettled(childExitPromises.values());
      if (currentServer !== undefined) await closeServer(currentServer);
      const currentRoot = rootPath;
      rootPath = undefined;
      if (currentRoot !== undefined) await rm(currentRoot, {recursive: true, force: true});
      repositories.clear();
      credentials.clear();
      requests.length = 0;
    },

    async createRepository(input) {
      assertRepositoryPart(input.owner, 'owner');
      assertRepositoryPart(input.name, 'repository');
      const defaultBranch = input.defaultBranch ?? 'main';
      const root = requireRoot();
      await assertBranchName(defaultBranch, root);
      if (input.files.length === 0) throw new Error('Test VCS repositories need at least one file');
      const key = repositoryKey(input.owner, input.name);
      if (repositories.has(key)) throw new Error(`Test VCS repository already exists: ${key}`);
      const barePath = join(root, input.owner, `${input.name}.git`);
      const seedPath = join(root, 'seeds', input.owner, input.name);
      await mkdir(dirname(barePath), {recursive: true});
      await mkdir(seedPath, {recursive: true});
      await git(['init', '--bare', barePath], root);
      await git(['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`], barePath);
      await git(['config', 'http.receivepack', 'true'], barePath);
      await git(['config', 'http.uploadpack', 'true'], barePath);
      await git(['init', '-b', defaultBranch, seedPath], seedPath);
      await configureSeedRepository(seedPath);
      await writeFiles(seedPath, input.files);
      await git(['add', '--all'], seedPath);
      await git(['commit', '-m', 'initial test VCS commit'], seedPath);
      await git(['remote', 'add', 'origin', barePath], seedPath);
      await git(['push', 'origin', `HEAD:${defaultBranch}`], seedPath);

      const snapshot = repositorySnapshot({
        owner: input.owner,
        name: input.name,
        defaultBranch,
        port: listeningPort(),
      });
      repositories.set(key, {snapshot, barePath, seedPath});
      return snapshot;
    },

    async commitFiles(input) {
      const repository = requireRepository(input.owner, input.name);
      if (input.files.length === 0) throw new Error('Test VCS commits need at least one file');
      await writeFiles(repository.seedPath, input.files);
      const status = await git(['status', '--porcelain'], repository.seedPath);
      if (status.trim() !== '') {
        await git(['add', '--all'], repository.seedPath);
        await git(['commit', '-m', input.message], repository.seedPath);
        await git(
          ['push', 'origin', `HEAD:${repository.snapshot.defaultBranch}`],
          repository.seedPath,
        );
      }
      return await currentCommit(repository.seedPath);
    },

    getRepository(owner, name) {
      return repositories.get(repositoryKey(owner, name))?.snapshot;
    },

    listRepositories(owner) {
      const values = [...repositories.values()]
        .filter((repository) => repository.snapshot.owner === owner)
        .map((repository) => repository.snapshot)
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      return {repositories: values, nextCursor: null};
    },

    async listFiles(input) {
      const repository = requireRepository(input.owner, input.name);
      const output = await git(['ls-tree', '-r', '-l', input.ref], repository.seedPath);
      const prefix = input.prefix.replace(/^\/+|\/+$/gu, '');
      const files = output
        .trimEnd()
        .split('\n')
        .filter(Boolean)
        .flatMap((line): FileEntry[] => {
          const [metadata, path] = line.split('\t', 2);
          const fields = metadata?.split(GIT_TREE_FIELD_PATTERN) ?? [];
          if (fields[1] !== 'blob' || !path || !matchesPrefix(path, prefix)) return [];
          const size = fields[3] === '-' ? null : Number(fields[3]);
          return [{path, type: 'file', size: Number.isFinite(size) ? size : null}];
        })
        .sort((left, right) => left.path.localeCompare(right.path));
      const offset = parseCursor(input.cursor);
      const page = files.slice(offset, offset + input.limit);
      const consumed = offset + page.length;
      return {files: page, nextCursor: consumed < files.length ? String(consumed) : null};
    },

    async fetchFile(input) {
      const repository = requireRepository(input.owner, input.name);
      assertRelativePath(input.path);
      const content = await git(['show', `${input.ref}:${input.path}`], repository.seedPath);
      if (Buffer.byteLength(content, 'utf8') > MAX_TEST_VCS_FILE_BYTES) {
        throw new Error('Test VCS file is too large');
      }
      return {path: input.path, ref: input.ref, content};
    },

    async resolveRef(input) {
      const repository = requireRepository(input.owner, input.name);
      const commit = await git(
        ['rev-parse', '--verify', `${input.ref}^{commit}`],
        repository.seedPath,
      );
      return {ref: input.ref, commit: commit.trim()};
    },

    issueCredential(input) {
      requireRepository(input.owner, input.name);
      if (!Number.isFinite(input.ttlSeconds) || input.ttlSeconds <= 0) {
        throw new Error('Test VCS credential TTL must be greater than zero');
      }
      let generation = randomUUID();
      while (generation === input.rejectedGeneration) generation = randomUUID();
      const token = `test-vcs-${randomUUID()}`;
      const now = Date.now();
      const expiresAt = now + input.ttlSeconds * 1000;
      credentials.set(token, {
        owner: input.owner,
        name: input.name,
        username: TEST_VCS_USERNAME,
        generation,
        token,
        permissions: input.permissions,
        expiresAt,
      });
      const renewal: CheckoutCredentialRenewal =
        input.renewalMode === 'refresh-at'
          ? {
              mode: 'refresh-at',
              refreshAt: new Date(now + Math.max(50, Math.floor(input.ttlSeconds * 500))),
            }
          : {mode: 'on-rejection'};
      return {
        username: TEST_VCS_USERNAME,
        token,
        expiresAt: new Date(expiresAt),
        generation,
        renewal,
      };
    },

    stats(owner) {
      const selected =
        owner === undefined ? requests : requests.filter((request) => request.owner === owner);
      const generations = [...credentials.values()]
        .filter((credential) => owner === undefined || credential.owner === owner)
        .map((credential) => credential.generation);
      return {
        mintCount: [...credentials.values()].filter(
          (credential) => owner === undefined || credential.owner === owner,
        ).length,
        requestCount: selected.length,
        acceptedRequestCount: selected.filter((request) => request.status === 'accepted').length,
        rejectedRequestCount: selected.filter((request) => request.status === 'rejected').length,
        generations,
        requests: selected.map(({method, path, status, generation}) => ({
          method,
          path,
          status,
          ...(generation === undefined ? {} : {generation}),
        })),
      };
    },
  };

  async function handleGitRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', 'https://test-vcs.invalid');
    const location = parseGitRepositoryPath(requestUrl.pathname);
    if (location === undefined) {
      request.resume();
      response.writeHead(404);
      response.end();
      return;
    }
    const repository = repositories.get(repositoryKey(location.owner, location.name));
    if (!repository) {
      request.resume();
      response.writeHead(404);
      response.end();
      return;
    }

    const credential = findCredential(request.headers.authorization);
    const needsWrite =
      requestUrl.pathname.endsWith('/git-receive-pack') ||
      requestUrl.searchParams.get('service') === 'git-receive-pack';
    const credentialUsable =
      credential !== undefined &&
      credential.owner === location.owner &&
      credential.name === location.name &&
      credential.expiresAt > Date.now() &&
      (credential.permissions.contents === 'write' || !needsWrite);
    const requestRecord = {
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      owner: location.owner,
    };
    if (!credentialUsable) {
      requests.push({
        ...requestRecord,
        status: 'rejected',
        ...(credential?.generation === undefined ? {} : {generation: credential.generation}),
      });
      request.resume();
      response.writeHead(401, {'www-authenticate': `Basic realm="${TEST_VCS_REALM}"`});
      response.end();
      return;
    }

    requests.push({
      ...requestRecord,
      status: 'accepted',
      generation: credential.generation,
    });
    await proxyToGitHttpBackend(
      request,
      response,
      repository.barePath,
      children,
      childExitPromises,
    );
  }

  function findCredential(authorization: string | undefined): CredentialRecord | undefined {
    if (!authorization?.startsWith('Basic ')) return undefined;
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    const username = decoded.slice(0, separator);
    const token = decoded.slice(separator + 1);
    return [...credentials.values()].find(
      (candidate) => candidate.username === username && candidate.token === token,
    );
  }

  function requireRoot(): string {
    if (rootPath === undefined || server === undefined) {
      throw new Error('Test VCS fixture is not started');
    }
    return rootPath;
  }

  function listeningPort(): number {
    if (server === undefined) throw new Error('Test VCS fixture is not started');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Test VCS fixture did not expose a TCP address');
    }
    return (address as AddressInfo).port;
  }

  function requireRepository(owner: string, name: string): RepositoryRecord {
    const repository = repositories.get(repositoryKey(owner, name));
    if (!repository) throw new Error(`Test VCS repository not found: ${owner}/${name}`);
    return repository;
  }

  return fixture;
}

export function createTestVcsFixtureService(fixture: TestVcsFixture): ModuleService {
  return {
    name: 'test-vcs-smart-http-fixture',
    shutdownTimeoutMs: 10_000,
    async start() {
      await fixture.start();
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      return {
        finished,
        async stop() {
          await fixture.close();
          resolveFinished();
        },
      };
    },
  };
}

async function createCertificate(keyPath: string, certificatePath: string): Promise<void> {
  await execFileAsync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
  ]);
}

async function configureSeedRepository(seedPath: string): Promise<void> {
  await git(['config', 'user.name', 'Shipfox Test VCS'], seedPath);
  await git(['config', 'user.email', 'test-vcs@shipfox.test'], seedPath);
  await git(['config', 'commit.gpgsign', 'false'], seedPath);
  await git(['config', 'tag.gpgSign', 'false'], seedPath);
}

async function writeFiles(directory: string, files: readonly TestVcsFileInput[]): Promise<void> {
  for (const file of files) {
    assertRelativePath(file.path);
    const path = join(directory, file.path);
    await mkdir(dirname(path), {recursive: true});
    await writeFile(path, file.content, {mode: 0o600});
  }
}

async function currentCommit(seedPath: string): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], seedPath)).trim();
}

function repositorySnapshot(input: {
  owner: string;
  name: string;
  defaultBranch: string;
  port: number;
}): RepositorySnapshot {
  const path = `/${input.owner}/${input.name}`;
  return {
    externalRepositoryId: `test-vcs:${input.owner}/${input.name}`,
    owner: input.owner,
    name: input.name,
    fullName: `${input.owner}/${input.name}`,
    defaultBranch: input.defaultBranch,
    visibility: 'private',
    cloneUrl: `https://127.0.0.1:${input.port}/${input.owner}/${input.name}.git`,
    htmlUrl: `https://test-vcs.invalid${path}`,
  };
}

function repositoryKey(owner: string, name: string): string {
  return `${owner}/${name}`;
}

function assertRepositoryPart(value: string, label: string): void {
  if (!REPOSITORY_PART_PATTERN.test(value)) throw new Error(`Invalid test VCS ${label}`);
}

export function isValidTestVcsBranchName(value: string): boolean {
  return !value.startsWith('-') && isValidGitRefName(`refs/heads/${value}`);
}

async function assertBranchName(value: string, cwd: string): Promise<void> {
  try {
    await git(['check-ref-format', '--branch', value], cwd);
  } catch {
    throw new Error('Invalid test VCS branch name');
  }
}

function assertRelativePath(value: string): void {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\u0000') ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid test VCS file path: ${value}`);
  }
}

function matchesPrefix(path: string, prefix: string): boolean {
  return prefix === '' || path === prefix || path.startsWith(`${prefix}/`);
}

function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseGitRepositoryPath(path: string): {owner: string; name: string} | undefined {
  const match = GIT_REPOSITORY_PATH_PATTERN.exec(path);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    const owner = decodeURIComponent(match[1]);
    const name = decodeURIComponent(match[2]);
    if (!REPOSITORY_PART_PATTERN.test(owner) || !REPOSITORY_PART_PATTERN.test(name)) {
      return undefined;
    }
    return {owner, name};
  } catch {
    return undefined;
  }
}

async function proxyToGitHttpBackend(
  request: IncomingMessage,
  response: ServerResponse,
  repositoryPath: string,
  children: Set<ChildProcess>,
  childExitPromises: Map<ChildProcess, Promise<number>>,
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'https://test-vcs.invalid');
  const child = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: dirname(dirname(repositoryPath)),
      GIT_HTTP_EXPORT_ALL: '1',
      PATH_INFO: requestUrl.pathname,
      QUERY_STRING: requestUrl.search.slice(1),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: String(request.headers['content-type'] ?? ''),
      CONTENT_LENGTH: String(request.headers['content-length'] ?? ''),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  const output = collect(child.stdout);
  const error = collect(child.stderr);
  const exitPromise = waitForExit(child, GIT_BACKEND_TIMEOUT_MS);
  childExitPromises.set(child, exitPromise);
  child.stdin.on('error', () => request.unpipe(child.stdin));
  request.pipe(child.stdin);
  let body: Buffer;
  let errorOutput: Buffer;
  let exitCode: number;
  try {
    [body, errorOutput, exitCode] = await Promise.all([output, error, exitPromise]);
  } catch (error) {
    await terminateChild(child);
    throw error;
  } finally {
    children.delete(child);
    childExitPromises.delete(child);
  }
  if (exitCode !== 0) throw new Error(`git-http-backend failed (${errorOutput.byteLength} bytes)`);
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
    let size = 0;
    let settled = false;
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.byteLength;
      if (size > MAX_GIT_OUTPUT_BYTES) {
        settled = true;
        reject(new Error('git-http-backend output exceeded the fixture limit'));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    stream.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    stream.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });
  child.kill();
  await exited;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`git-http-backend timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

async function git(args: string[], cwd: string): Promise<string> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      env: {...process.env, GIT_TERMINAL_PROMPT: '0'},
    });
    return result.stdout;
  } catch (error) {
    throw new Error(`Test VCS git operation failed in ${basename(cwd)}`, {cause: error});
  }
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
