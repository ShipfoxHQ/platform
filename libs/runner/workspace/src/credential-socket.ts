import {chmod, lstat, mkdir, rm} from 'node:fs/promises';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {dirname} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {
  type CredentialBroker,
  type CredentialLookup,
  normalizeRepositoryUrl,
} from '#credential-broker.js';
import {recordCredentialSocketRequest} from '#credential-metrics.js';

const PROTOCOL_VERSION = 1;
const MAX_SOCKET_PATH_BYTES = 103;
const MAX_CAPABILITY_BYTES = 512;
const MAX_MESSAGE_BYTES = 16 * 1_024;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const SOCKET_TIMEOUT_HEADROOM_MS = 5_000;
const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;
const SOCKET_MODE = 0o600;

export type CredentialSocketOperation = 'get' | 'store' | 'erase';

export type CredentialSocketRequest = {
  version: typeof PROTOCOL_VERSION;
  operation: CredentialSocketOperation;
  repositoryUrl: string;
  capability: string;
};

export type CredentialSocketResponse =
  | {version: typeof PROTOCOL_VERSION; ok: true; credential?: CredentialLookup}
  | {version: typeof PROTOCOL_VERSION; ok: false};

export type CredentialSocketServerOptions = {
  socketPath: string;
  capability: string;
  broker: CredentialBroker;
};

export type CredentialSocketServer = {
  readonly socketPath: string;
  start(): Promise<void>;
  close(): Promise<void>;
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
 * Creates the private, one-job transport for the credential broker. Messages contain only
 * repository identity, operation, and the job capability; Git-supplied credentials are never
 * sent to the broker.
 */
export function createCredentialSocketServer(
  options: CredentialSocketServerOptions,
): CredentialSocketServer {
  assertSocketPath(options.socketPath);
  assertCredentialSocketCapability(options.capability);
  let server: Server | undefined;
  let started = false;
  let closed = false;
  let lifecycle: Promise<void> = Promise.resolve();
  const connections = new Set<Socket>();
  const inFlight = new Set<Promise<void>>();
  const socketTimeoutMs = options.broker.renewalTimeoutMs + SOCKET_TIMEOUT_HEADROOM_MS;

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
    socket.once('close', () => {
      connections.delete(socket);
      abortController.abort();
    });
    socket.setTimeout(socketTimeoutMs, () => socket.destroy());
    let body = Buffer.alloc(0);
    let tooLarge = false;

    socket.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_MESSAGE_BYTES) {
        tooLarge = true;
        socket.destroy();
      }
    });
    socket.once('error', () => undefined);
    socket.once('end', () => {
      if (tooLarge) return;
      const response = respond(
        socket,
        body,
        options.broker,
        options.capability,
        abortController.signal,
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
    await prepareSocketPath(options.socketPath);
    assertServerOpen();

    const nextServer = createServer({allowHalfOpen: true}, handleConnection);
    let listening = false;
    try {
      await listen(nextServer, options.socketPath);
      listening = true;
      assertServerOpen();
      await chmod(options.socketPath, SOCKET_MODE);
      server = nextServer;
      started = true;
    } catch {
      for (const connection of connections) connection.destroy();
      if (listening) await closeServer(nextServer);
      else nextServer.close();
      await rm(options.socketPath, {force: true});
      throw new CredentialSocketError('Credential socket could not start');
    }
  }

  function assertServerOpen(): void {
    if (closed) throw new CredentialSocketError('Credential socket is closed');
  }

  async function closeServerForJob(): Promise<void> {
    if (closed) return;
    closed = true;
    options.broker.shutdown();
    const currentServer = server;
    server = undefined;
    started = false;
    if (currentServer !== undefined) {
      for (const connection of connections) connection.destroy();
      await closeServer(currentServer);
    }
    await Promise.allSettled(inFlight);
    await rm(options.socketPath, {force: true});
  }
}

/** Sends one bounded request to a job's credential socket. */
export async function requestCredentialSocket(
  socketPath: string,
  request: Omit<CredentialSocketRequest, 'version'>,
): Promise<CredentialSocketResponse> {
  assertSocketPath(socketPath);
  assertCredentialSocketCapability(request.capability);
  const encoded = encodeMessage({version: PROTOCOL_VERSION, ...request});
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await requestCredentialSocketAttempt(socketPath, encoded);
    } catch (error) {
      lastError = error;
      if (
        !isTransientSocketError(error) ||
        request.operation === 'erase' ||
        attempt === MAX_REQUEST_ATTEMPTS - 1
      )
        throw error;
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

function requestCredentialSocketAttempt(
  socketPath: string,
  encoded: Buffer,
): Promise<CredentialSocketResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let body = Buffer.alloc(0);
    let settled = false;
    let connected = false;

    const fail = (error?: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      const code = error?.code ?? (connected ? 'ECONNRESET' : 'ECONNREFUSED');
      reject(new CredentialSocketError(`Credential socket request failed (${code})`, code));
    };
    socket.once('error', fail);
    socket.once('close', () => fail());
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_RESPONSE_BYTES) {
        socket.destroy();
        fail({code: 'EMSGSIZE'} as NodeJS.ErrnoException);
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

function isTransientSocketError(error: unknown): boolean {
  if (!(error instanceof CredentialSocketError)) return false;
  return ['EAGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENOENT', 'ETIMEDOUT'].includes(error.code);
}

function retryDelay(attempt: number): Promise<void> {
  const jitter = Math.floor(Math.random() * RETRY_BACKOFF_MS);
  return new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS * 2 ** attempt + jitter));
}

async function respond(
  socket: Socket,
  body: Buffer,
  broker: CredentialBroker,
  capability: string,
  signal: AbortSignal,
): Promise<void> {
  let response: CredentialSocketResponse;
  let operation: 'get' | 'store' | 'erase' | 'unknown' = 'unknown';
  try {
    const request = decodeRequest(body);
    operation = request.operation;
    response = await handleRequest(request, broker, capability, signal);
    if (signal.aborted) return;
    recordCredentialSocketRequest(operation, response.ok ? 'success' : 'rejected');
  } catch (error) {
    if (signal.aborted) return;
    recordCredentialSocketRequest(operation, 'error');
    logger().warn(
      {operation, reason: error instanceof Error ? error.name : 'UnknownError'},
      'Credential socket request rejected',
    );
    response = {version: PROTOCOL_VERSION, ok: false};
  }

  if (signal.aborted) return;
  try {
    socket.end(encodeMessage(response));
  } catch {
    socket.destroy();
  }
}

async function handleRequest(
  request: CredentialSocketRequest,
  broker: CredentialBroker,
  capability: string,
  signal: AbortSignal,
): Promise<CredentialSocketResponse> {
  if (request.capability !== capability) return {version: PROTOCOL_VERSION, ok: false};
  if (signal.aborted) return {version: PROTOCOL_VERSION, ok: false};
  if (request.operation === 'get') {
    const credential = await awaitUnlessCanceled(broker.lookup(request.repositoryUrl), signal);
    return credential === undefined
      ? {version: PROTOCOL_VERSION, ok: true}
      : {version: PROTOCOL_VERSION, ok: true, credential};
  }
  if (request.operation === 'store') {
    broker.store(request.repositoryUrl);
    return {version: PROTOCOL_VERSION, ok: true};
  }
  await awaitUnlessCanceled(broker.erase(request.repositoryUrl), signal);
  return {version: PROTOCOL_VERSION, ok: true};
}

async function awaitUnlessCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const value = await operation;
  if (signal.aborted) {
    throw new CredentialSocketError('Credential socket request was canceled', 'ECANCELED');
  }
  return value;
}

function decodeRequest(body: Buffer): CredentialSocketRequest {
  const value = parseMessage(body);
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    (value.operation !== 'get' && value.operation !== 'store' && value.operation !== 'erase') ||
    typeof value.repositoryUrl !== 'string' ||
    value.repositoryUrl.length === 0 ||
    typeof value.capability !== 'string'
  ) {
    throw new CredentialSocketError('Invalid credential socket request');
  }
  assertCredentialSocketCapability(value.capability);
  normalizeRepositoryUrl(value.repositoryUrl);
  return {
    version: PROTOCOL_VERSION,
    operation: value.operation,
    repositoryUrl: value.repositoryUrl,
    capability: value.capability,
  };
}

function decodeResponse(body: Buffer): CredentialSocketResponse {
  const value = parseMessage(body);
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || typeof value.ok !== 'boolean') {
    throw new CredentialSocketError('Invalid credential socket response');
  }
  if (!value.ok) return {version: PROTOCOL_VERSION, ok: false};
  if (value.credential === undefined) return {version: PROTOCOL_VERSION, ok: true};
  if (!isRecord(value.credential)) throw new CredentialSocketError();
  const {username, token} = value.credential;
  if (typeof username !== 'string' || typeof token !== 'string') {
    throw new CredentialSocketError();
  }
  return {version: PROTOCOL_VERSION, ok: true, credential: {username, token}};
}

function parseMessage(body: Buffer): unknown {
  const text = body.toString('utf8');
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) {
    throw new CredentialSocketError('Invalid credential socket framing');
  }
  return JSON.parse(text.slice(0, -1));
}

function encodeMessage(value: CredentialSocketRequest | CredentialSocketResponse): Buffer {
  const encoded = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (encoded.length > (isResponse(value) ? MAX_RESPONSE_BYTES : MAX_MESSAGE_BYTES)) {
    throw new CredentialSocketError('Credential socket message is too large');
  }
  return encoded;
}

function isResponse(
  value: CredentialSocketRequest | CredentialSocketResponse,
): value is CredentialSocketResponse {
  return 'ok' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function prepareSocketPath(socketPath: string): Promise<void> {
  await mkdir(dirname(socketPath), {recursive: true, mode: 0o700});
  try {
    const stats = await lstat(socketPath);
    if (!stats.isSocket()) throw new CredentialSocketError('Credential socket path is occupied');
    await rm(socketPath);
  } catch (error) {
    if (error instanceof CredentialSocketError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function assertSocketPath(socketPath: string): void {
  if (
    typeof socketPath !== 'string' ||
    socketPath.length === 0 ||
    Buffer.byteLength(socketPath, 'utf8') > MAX_SOCKET_PATH_BYTES ||
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
    Buffer.byteLength(capability, 'utf8') > MAX_CAPABILITY_BYTES ||
    [...capability].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new CredentialSocketError('Invalid credential socket capability');
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

function createConnection(socketPath: string): Socket {
  return connect(socketPath);
}
