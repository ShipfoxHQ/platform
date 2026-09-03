import {randomUUID} from 'node:crypto';
import type {Dirent} from 'node:fs';
import {
  chmod,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
} from 'node:fs/promises';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {basename, dirname, join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';

export const CREDENTIAL_SOCKET_PROTOCOL_VERSION = 1 as const;
export const MAX_CREDENTIAL_SOCKET_PATH_BYTES = 103;
export const MAX_CREDENTIAL_SOCKET_CAPABILITY_BYTES = 512;
export const MAX_CREDENTIAL_SOCKET_REQUEST_BYTES = 16 * 1_024;
export const MAX_CREDENTIAL_SOCKET_RESPONSE_BYTES = 64 * 1_024;
export const CREDENTIAL_SOCKET_TIMEOUT_HEADROOM_MS = 5_000;
export const DEFAULT_CREDENTIAL_SOCKET_TIMEOUT_MS = 35_000;
export const MAX_CREDENTIAL_SOCKET_REQUEST_ATTEMPTS = 3;
export const CREDENTIAL_SOCKET_RETRY_BACKOFF_MS = 25;
export const CREDENTIAL_SOCKET_MODE = 0o600;
export const MAX_CREDENTIAL_SOCKET_TIMEOUT_MS = 2_147_483_647;
const CREDENTIAL_SOCKET_PATH_PROBE_TIMEOUT_MS = 100;
const CREDENTIAL_SOCKET_LOCK_SUFFIX = '.lock';
const CREDENTIAL_SOCKET_LOCK_ARTIFACT_RE = /^(?:[0-9]+\.)?[0-9a-f-]+\.(?:tmp|stale)$/u;

export type CredentialSocketTransportRequest = {
  version: typeof CREDENTIAL_SOCKET_PROTOCOL_VERSION;
  capability: string;
  [key: string]: unknown;
};

export type CredentialSocketTransportRequestInput = {
  capability: string;
  [key: string]: unknown;
};

export type CredentialSocketTransportResponse = {
  version: typeof CREDENTIAL_SOCKET_PROTOCOL_VERSION;
  ok: boolean;
  [key: string]: unknown;
};

export type CredentialSocketTransportResponseInput = {
  ok: boolean;
  [key: string]: unknown;
};

export type CredentialSocketTransportRejectionOutcome = 'rejected' | 'error';

export type CredentialSocketTransportRejectionHandler = (
  request: CredentialSocketTransportRequest | undefined,
  outcome: CredentialSocketTransportRejectionOutcome,
) => void;

export type CredentialSocketTransportHandler = (
  request: CredentialSocketTransportRequest,
  signal: AbortSignal,
) =>
  | CredentialSocketTransportResponseInput
  | CredentialSocketTransportResponse
  | Promise<CredentialSocketTransportResponseInput | CredentialSocketTransportResponse>;

export type CredentialSocketTransportServerOptions = {
  socketPath: string;
  capability: string;
  timeoutMs: number;
  handleRequest: CredentialSocketTransportHandler;
  onRequestRejected?: CredentialSocketTransportRejectionHandler;
};

export type CredentialSocketTransportServer = {
  readonly socketPath: string;
  start(): Promise<void>;
  close(): Promise<void>;
};

export type CredentialSocketTransportClientOptions = {
  timeoutMs?: number;
  shouldRetry?: (error: CredentialSocketError, attempt: number) => boolean;
};

export class CredentialSocketError extends Error {
  constructor(
    message = 'Credential socket request failed',
    public readonly code = 'EPROTO',
  ) {
    super(message);
    this.name = 'CredentialSocketError';
  }
}

/**
 * Creates a bounded, capability-scoped Unix-socket transport. The handler owns the
 * request and response payloads; this layer owns their framing and connection lifecycle.
 */
export function createCredentialSocketTransportServer(
  options: CredentialSocketTransportServerOptions,
): CredentialSocketTransportServer {
  assertSocketPath(options.socketPath);
  assertCredentialSocketCapability(options.capability);
  assertCredentialSocketTimeout(options.timeoutMs);

  let server: Server | undefined;
  let started = false;
  let closed = false;
  let lifecycle: Promise<void> = Promise.resolve();
  let socketLock: FileHandle | undefined;
  const connections = new Set<Socket>();
  const inFlight = new Set<Promise<void>>();

  const enqueueLifecycle = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = lifecycle.then(operation);
    lifecycle = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const handleConnection = (socket: Socket): void => {
    connections.add(socket);
    const abortController = new AbortController();
    let rejectionReported = false;
    const reportRejection = (
      request: CredentialSocketTransportRequest | undefined,
      outcome: CredentialSocketTransportRejectionOutcome,
    ): void => {
      if (rejectionReported) return;
      rejectionReported = true;
      try {
        options.onRequestRejected?.(request, outcome);
      } catch {
        // Rejection reporting must not affect socket cleanup.
      }
    };
    socket.once('close', () => {
      connections.delete(socket);
      abortController.abort();
    });
    socket.setTimeout(options.timeoutMs, () => {
      reportRejection(undefined, 'error');
      socket.destroy();
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    socket.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_CREDENTIAL_SOCKET_REQUEST_BYTES) {
        tooLarge = true;
        reportRejection(undefined, 'error');
        socket.destroy();
        return;
      }
      chunks.push(chunk);
    });
    socket.once('error', () => undefined);
    socket.once('end', () => {
      if (tooLarge) return;
      const response = respond(
        socket,
        Buffer.concat(chunks),
        options.capability,
        options.handleRequest,
        abortController.signal,
        reportRejection,
      );
      inFlight.add(response);
      void response.then(
        () => inFlight.delete(response),
        () => inFlight.delete(response),
      );
    });
  };

  return {
    socketPath: options.socketPath,
    start() {
      return enqueueLifecycle(startServer);
    },
    close() {
      return enqueueLifecycle(closeServerForJob);
    },
  };

  async function startServer(): Promise<void> {
    if (started) return;
    assertServerOpen();
    const nextSocketLock = await acquireSocketLock(options.socketPath);
    let keepSocketLock = false;
    try {
      await prepareSocketPath(options.socketPath);
      assertServerOpen();

      const nextServer = createServer({allowHalfOpen: true}, handleConnection);
      let listening = false;
      try {
        await listen(nextServer, options.socketPath);
        listening = true;
        assertServerOpen();
        await chmod(options.socketPath, CREDENTIAL_SOCKET_MODE);
        server = nextServer;
        socketLock = nextSocketLock;
        keepSocketLock = true;
        started = true;
      } catch {
        for (const connection of connections) connection.destroy();
        if (listening) await closeServer(nextServer);
        else nextServer.close();
        throw new CredentialSocketError('Credential socket could not start');
      }
    } finally {
      if (!keepSocketLock) await releaseSocketLock(options.socketPath, nextSocketLock);
    }
  }

  function assertServerOpen(): void {
    if (closed) throw new CredentialSocketError('Credential socket is closed');
  }

  async function closeServerForJob(): Promise<void> {
    if (closed) return;
    closed = true;
    const lock = socketLock;
    socketLock = undefined;
    const currentServer = server;
    server = undefined;
    started = false;
    for (const connection of connections) connection.destroy();
    if (currentServer !== undefined) await closeServer(currentServer);
    await Promise.allSettled(inFlight);
    if (lock !== undefined) await releaseSocketLock(options.socketPath, lock);
  }
}

/** Sends one bounded request to a capability-scoped socket. */
export async function requestCredentialSocketTransport(
  socketPath: string,
  request: CredentialSocketTransportRequestInput,
  options: CredentialSocketTransportClientOptions = {},
): Promise<CredentialSocketTransportResponse> {
  assertSocketPath(socketPath);
  assertCredentialSocketCapability(request.capability);
  const timeoutMs = options.timeoutMs ?? DEFAULT_CREDENTIAL_SOCKET_TIMEOUT_MS;
  assertCredentialSocketTimeout(timeoutMs);
  const encoded = encodeRequest({
    ...request,
    version: CREDENTIAL_SOCKET_PROTOCOL_VERSION,
  } as CredentialSocketTransportRequest);
  let lastError: CredentialSocketError | undefined;

  for (let attempt = 0; attempt < MAX_CREDENTIAL_SOCKET_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await requestCredentialSocketAttempt(socketPath, encoded, timeoutMs);
    } catch (error) {
      const socketError = toCredentialSocketError(error);
      lastError = socketError;
      const shouldRetry = options.shouldRetry?.(socketError, attempt) ?? true;
      if (
        !isTransientCredentialSocketError(socketError) ||
        !shouldRetry ||
        attempt === MAX_CREDENTIAL_SOCKET_REQUEST_ATTEMPTS - 1
      )
        throw socketError;
      await retryDelay(attempt);
    }
  }
  throw lastError ?? new CredentialSocketError();
}

export function isTransientCredentialSocketError(error: unknown): error is CredentialSocketError {
  if (!(error instanceof CredentialSocketError)) return false;
  return ['EAGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'ETIMEDOUT'].includes(error.code);
}

function requestCredentialSocketAttempt(
  socketPath: string,
  encoded: Buffer,
  timeoutMs: number,
): Promise<CredentialSocketTransportResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let body = Buffer.alloc(0);
    let settled = false;
    let connected = false;

    const fail = (error?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      const code = error?.code ?? (connected ? 'ECONNRESET' : 'ECONNREFUSED');
      reject(new CredentialSocketError(`Credential socket request failed (${code})`, code));
    };
    socket.setTimeout(timeoutMs, () => {
      fail({code: 'ETIMEDOUT'} as NodeJS.ErrnoException);
      socket.destroy();
    });
    socket.once('error', fail);
    socket.once('close', () => fail());
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_CREDENTIAL_SOCKET_RESPONSE_BYTES) {
        fail({code: 'EMSGSIZE'} as NodeJS.ErrnoException);
        socket.destroy();
      }
    });
    socket.once('end', () => {
      if (settled) return;
      try {
        const response = decodeResponse(body);
        settled = true;
        resolve(response);
      } catch {
        fail({code: 'EPROTO'} as NodeJS.ErrnoException);
      }
    });
    socket.once('connect', () => {
      connected = true;
      socket.end(encoded);
    });
  });
}

async function respond(
  socket: Socket,
  body: Buffer,
  capability: string,
  handleRequest: CredentialSocketTransportHandler,
  signal: AbortSignal,
  onRequestRejected: CredentialSocketTransportRejectionHandler,
): Promise<void> {
  let response: CredentialSocketTransportResponse;
  let request: CredentialSocketTransportRequest | undefined;
  try {
    request = decodeRequest(body);
    if (signal.aborted) return;
    if (request.capability !== capability) {
      onRequestRejected(request, 'rejected');
      response = {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
    } else {
      response = normalizeResponse(await handleRequest(request, signal));
      if (signal.aborted) return;
    }
  } catch (error) {
    if (signal.aborted) return;
    onRequestRejected(request, 'error');
    logger().warn(
      {reason: error instanceof Error ? error.name : 'UnknownError'},
      'Credential socket request rejected',
    );
    response = {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
  }

  if (signal.aborted) return;
  sendResponse(socket, response);
}

function sendResponse(socket: Socket, response: CredentialSocketTransportResponse): void {
  try {
    socket.end(encodeResponse(response));
    return;
  } catch {
    // A handler response can exceed the response bound or fail JSON encoding. Return a
    // bounded rejection so clients do not retry a request whose handler already ran.
  }
  try {
    socket.end(encodeResponse({version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false}));
  } catch {
    socket.destroy();
  }
}

function decodeRequest(body: Buffer): CredentialSocketTransportRequest {
  const value = parseMessage(body);
  if (
    !isRecord(value) ||
    value.version !== CREDENTIAL_SOCKET_PROTOCOL_VERSION ||
    typeof value.capability !== 'string'
  ) {
    throw new CredentialSocketError('Invalid credential socket request');
  }
  assertCredentialSocketCapability(value.capability);
  return value as CredentialSocketTransportRequest;
}

function decodeResponse(body: Buffer): CredentialSocketTransportResponse {
  const value = parseMessage(body);
  if (
    !isRecord(value) ||
    value.version !== CREDENTIAL_SOCKET_PROTOCOL_VERSION ||
    typeof value.ok !== 'boolean'
  ) {
    throw new CredentialSocketError('Invalid credential socket response');
  }
  return value as CredentialSocketTransportResponse;
}

function normalizeResponse(value: unknown): CredentialSocketTransportResponse {
  if (
    !isRecord(value) ||
    (value.version !== undefined && value.version !== CREDENTIAL_SOCKET_PROTOCOL_VERSION) ||
    typeof value.ok !== 'boolean'
  ) {
    throw new CredentialSocketError('Invalid credential socket response');
  }
  const {ok, ...payload} = value;
  return {...payload, version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok};
}

function parseMessage(body: Buffer): unknown {
  const text = body.toString('utf8');
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
    throw new CredentialSocketError('Invalid credential socket framing');
  }
  try {
    return JSON.parse(text.slice(0, -1));
  } catch {
    throw new CredentialSocketError('Invalid credential socket message');
  }
}

function encodeRequest(value: CredentialSocketTransportRequest): Buffer {
  return encodeMessage(value, MAX_CREDENTIAL_SOCKET_REQUEST_BYTES, 'request');
}

function encodeResponse(value: CredentialSocketTransportResponse): Buffer {
  return encodeMessage(value, MAX_CREDENTIAL_SOCKET_RESPONSE_BYTES, 'response');
}

function encodeMessage(value: object, maxBytes: number, kind: string): Buffer {
  let encoded: Buffer;
  try {
    encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  } catch {
    throw new CredentialSocketError(`Credential socket ${kind} could not be encoded`);
  }
  if (encoded.length > maxBytes) {
    throw new CredentialSocketError(`Credential socket ${kind} is too large`, 'EMSGSIZE');
  }
  return encoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCredentialSocketError(error: unknown): CredentialSocketError {
  if (error instanceof CredentialSocketError) return error;
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'EPROTO';
  return new CredentialSocketError('Credential socket request failed', code);
}

function retryDelay(attempt: number): Promise<void> {
  const jitter = Math.floor(Math.random() * CREDENTIAL_SOCKET_RETRY_BACKOFF_MS);
  return new Promise((resolve) =>
    setTimeout(resolve, CREDENTIAL_SOCKET_RETRY_BACKOFF_MS * 2 ** attempt + jitter),
  );
}

async function prepareSocketPath(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), {recursive: true, mode: 0o700});
  try {
    const stats = await lstat(socketPath);
    if (!stats.isSocket()) throw new CredentialSocketError('Credential socket path is occupied');
    if (await isSocketActive(socketPath)) {
      throw new CredentialSocketError('Credential socket path is occupied');
    }
    await rm(socketPath);
  } catch (error) {
    if (error instanceof CredentialSocketError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Serializes transport instances so socket cleanup cannot race another owner. */
async function acquireSocketLock(socketPath: string): Promise<FileHandle> {
  const lockPath = `${socketPath}${CREDENTIAL_SOCKET_LOCK_SUFFIX}`;
  await mkdir(dirname(socketPath), {recursive: true, mode: 0o700});
  await sweepSocketLockArtifacts(socketPath);
  const candidatePath = `${lockPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(candidatePath, 'wx', 0o600);
  let lockPublished = false;
  let ownershipTransferred = false;
  try {
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    for (;;) {
      if (!(await tryPublishSocketLock(socketPath, lockPath, candidatePath))) continue;
      lockPublished = true;
      await rm(candidatePath, {force: true});
      ownershipTransferred = true;
      return handle;
    }
  } finally {
    if (!ownershipTransferred)
      await cleanupSocketLockCandidate(lockPath, candidatePath, handle, lockPublished);
  }
}

async function tryPublishSocketLock(
  socketPath: string,
  lockPath: string,
  candidatePath: string,
): Promise<boolean> {
  try {
    await link(candidatePath, lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existingLock = await readSocketLock(lockPath);
    if (existingLock === undefined) return false;
    if (await socketLockRecordOwnerIsAlive(socketPath, existingLock)) {
      throw new CredentialSocketError('Credential socket path is occupied');
    }
    await tryReclaimStaleSocketLock(socketPath, lockPath, existingLock);
    return false;
  }
}

async function cleanupSocketLockCandidate(
  lockPath: string,
  candidatePath: string,
  handle: FileHandle,
  lockPublished: boolean,
): Promise<void> {
  try {
    if (lockPublished) await rm(lockPath, {force: true});
  } finally {
    try {
      await rm(candidatePath, {force: true});
    } finally {
      await handle.close();
    }
  }
}

async function readSocketLock(lockPath: string): Promise<string | undefined> {
  try {
    const stats = await lstat(lockPath);
    return stats.isSymbolicLink() ? await readlink(lockPath) : await readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function socketLockRecordOwnerIsAlive(socketPath: string, record: string): Promise<boolean> {
  const owner = Number(record.trim().split(':', 1)[0]);
  if (!Number.isSafeInteger(owner) || owner <= 0) return isSocketActive(socketPath);
  try {
    process.kill(owner, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
      ? await isSocketActive(socketPath)
      : true;
  }
}

async function tryReclaimStaleSocketLock(
  socketPath: string,
  lockPath: string,
  expectedLock: string,
): Promise<boolean> {
  const stalePath = `${lockPath}.${process.pid}.${randomUUID()}.stale`;
  try {
    await rename(lockPath, stalePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }

  const currentLock = await readSocketLock(stalePath);
  if (currentLock !== expectedLock) {
    await restoreSocketLock(stalePath, lockPath);
    return false;
  }

  if (await isSocketActive(socketPath)) {
    await restoreSocketLock(stalePath, lockPath);
    return false;
  }

  await rm(stalePath, {force: true});
  return true;
}

async function restoreSocketLock(stalePath: string, lockPath: string): Promise<void> {
  try {
    await link(stalePath, lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'ENOENT') throw error;
  } finally {
    await rm(stalePath, {force: true});
  }
}

async function sweepSocketLockArtifacts(socketPath: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dirname(socketPath), {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  const prefix = `${basename(socketPath)}${CREDENTIAL_SOCKET_LOCK_SUFFIX}.`;
  await Promise.all(
    entries
      .filter(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) &&
          entry.name.startsWith(prefix) &&
          CREDENTIAL_SOCKET_LOCK_ARTIFACT_RE.test(entry.name.slice(prefix.length)),
      )
      .map(async (entry) => {
        const artifactPath = join(dirname(socketPath), entry.name);
        const record = await readSocketLock(artifactPath);
        if (record !== undefined && (await socketLockRecordOwnerIsAlive(socketPath, record)))
          return;
        await rm(artifactPath, {force: true});
      }),
  );
}

async function releaseSocketLock(socketPath: string, lock: FileHandle): Promise<void> {
  try {
    await rm(`${socketPath}${CREDENTIAL_SOCKET_LOCK_SUFFIX}`, {force: true});
  } finally {
    await lock.close();
  }
}

function isSocketActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath);
    let settled = false;
    const finish = (active: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(active);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code !== 'ECONNREFUSED' && error.code !== 'ENOENT');
    });
    socket.once('close', () => finish(false));
    socket.setTimeout(CREDENTIAL_SOCKET_PATH_PROBE_TIMEOUT_MS, () => finish(true));
  });
}

export function assertSocketPath(socketPath: string): void {
  if (
    typeof socketPath !== 'string' ||
    socketPath.length === 0 ||
    Buffer.byteLength(socketPath, 'utf8') > MAX_CREDENTIAL_SOCKET_PATH_BYTES ||
    !socketPath.startsWith('/') ||
    [...socketPath].some((character) => character.charCodeAt(0) <= 0x1f || character === '\u007f')
  ) {
    throw new CredentialSocketError('Invalid credential socket path');
  }
}

export function assertCredentialSocketCapability(capability: string): void {
  if (
    typeof capability !== 'string' ||
    capability.length === 0 ||
    Buffer.byteLength(capability, 'utf8') > MAX_CREDENTIAL_SOCKET_CAPABILITY_BYTES ||
    [...capability].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new CredentialSocketError('Invalid credential socket capability');
  }
}

export function assertCredentialSocketTimeout(timeoutMs: number): void {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_CREDENTIAL_SOCKET_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Credential socket timeout must be between 1 and ${MAX_CREDENTIAL_SOCKET_TIMEOUT_MS} milliseconds`,
    );
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
}
