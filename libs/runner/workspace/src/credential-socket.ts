import {chmod, lstat, mkdir, rm} from 'node:fs/promises';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {dirname} from 'node:path';
import type {CredentialBroker, CredentialLookup} from '#credential-broker.js';

const PROTOCOL_VERSION = 1;
const MAX_SOCKET_PATH_LENGTH = 4_096;
const MAX_MESSAGE_BYTES = 16 * 1_024;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const SOCKET_TIMEOUT_MS = 35_000;
const SOCKET_MODE = 0o600;

export type CredentialSocketOperation = 'get' | 'store' | 'erase';

export type CredentialSocketRequest = {
  version: typeof PROTOCOL_VERSION;
  operation: CredentialSocketOperation;
  repositoryUrl: string;
};

export type CredentialSocketResponse =
  | {version: typeof PROTOCOL_VERSION; ok: true; credential?: CredentialLookup}
  | {version: typeof PROTOCOL_VERSION; ok: false};

export type CredentialSocketServerOptions = {
  socketPath: string;
  broker: CredentialBroker;
};

export type CredentialSocketServer = {
  readonly socketPath: string;
  start(): Promise<void>;
  close(): Promise<void>;
};

export class CredentialSocketError extends Error {
  constructor(message = 'Credential socket request failed') {
    super(message);
    this.name = 'CredentialSocketError';
  }
}

/**
 * Creates the private, one-job transport for the credential broker. Messages contain only
 * repository identity and the operation; Git-supplied credentials are never sent to the broker.
 */
export function createCredentialSocketServer(
  options: CredentialSocketServerOptions,
): CredentialSocketServer {
  assertSocketPath(options.socketPath);
  let server: Server | undefined;
  let started = false;
  let closed = false;
  const connections = new Set<Socket>();

  const handleConnection = (socket: Socket): void => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => socket.destroy());
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
      void respond(socket, body, options.broker);
    });
  };

  return {
    socketPath: options.socketPath,
    async start() {
      if (started) return;
      if (closed) throw new CredentialSocketError('Credential socket is closed');
      await prepareSocketPath(options.socketPath);
      server = createServer({allowHalfOpen: true}, handleConnection);
      try {
        await listen(server, options.socketPath);
        await chmod(options.socketPath, SOCKET_MODE);
        started = true;
      } catch {
        server.close();
        server = undefined;
        await rm(options.socketPath, {force: true});
        throw new CredentialSocketError('Credential socket could not start');
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      const currentServer = server;
      server = undefined;
      if (currentServer === undefined) {
        await rm(options.socketPath, {force: true});
        return;
      }
      for (const connection of connections) connection.destroy();
      await new Promise<void>((resolve) => {
        currentServer.close(() => resolve());
      });
      await rm(options.socketPath, {force: true});
    },
  };
}

/** Sends one bounded request to a job's credential socket. */
export function requestCredentialSocket(
  socketPath: string,
  request: Omit<CredentialSocketRequest, 'version'>,
): Promise<CredentialSocketResponse> {
  assertSocketPath(socketPath);
  const encoded = encodeMessage({version: PROTOCOL_VERSION, ...request});
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => {
      socket.destroy();
    });
    let body = Buffer.alloc(0);
    let settled = false;

    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new CredentialSocketError());
    };
    socket.once('error', fail);
    socket.once('close', fail);
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      body = Buffer.concat([body, chunk]);
      if (body.length > MAX_RESPONSE_BYTES) {
        socket.destroy();
        fail();
      }
    });
    socket.once('end', () => {
      if (settled) return;
      try {
        const response = decodeResponse(body);
        settled = true;
        resolve(response);
      } catch {
        fail();
      }
    });
    socket.once('connect', () => {
      socket.end(encoded);
    });
  });
}

async function respond(socket: Socket, body: Buffer, broker: CredentialBroker): Promise<void> {
  let response: CredentialSocketResponse;
  try {
    const request = decodeRequest(body);
    response = await handleRequest(request, broker);
  } catch {
    response = {version: PROTOCOL_VERSION, ok: false};
  }

  try {
    socket.end(encodeMessage(response));
  } catch {
    socket.destroy();
  }
}

async function handleRequest(
  request: CredentialSocketRequest,
  broker: CredentialBroker,
): Promise<CredentialSocketResponse> {
  if (request.operation === 'get') {
    const credential = await broker.lookup(request.repositoryUrl);
    return credential === undefined
      ? {version: PROTOCOL_VERSION, ok: true}
      : {version: PROTOCOL_VERSION, ok: true, credential};
  }
  if (request.operation === 'store') {
    broker.store(request.repositoryUrl);
    return {version: PROTOCOL_VERSION, ok: true};
  }
  await broker.erase(request.repositoryUrl);
  return {version: PROTOCOL_VERSION, ok: true};
}

function decodeRequest(body: Buffer): CredentialSocketRequest {
  const value = parseMessage(body);
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    (value.operation !== 'get' && value.operation !== 'store' && value.operation !== 'erase') ||
    typeof value.repositoryUrl !== 'string' ||
    value.repositoryUrl.length === 0
  ) {
    throw new CredentialSocketError('Invalid credential socket request');
  }
  return {
    version: PROTOCOL_VERSION,
    operation: value.operation,
    repositoryUrl: value.repositoryUrl,
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
    socketPath.length > MAX_SOCKET_PATH_LENGTH ||
    !socketPath.startsWith('/') ||
    [...socketPath].some((character) => character.charCodeAt(0) <= 0x1f || character === '\u007f')
  ) {
    throw new CredentialSocketError('Invalid credential socket path');
  }
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
