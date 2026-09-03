import {logger} from '@shipfox/node-opentelemetry';
import {
  type CredentialBroker,
  type CredentialLookup,
  normalizeRepositoryUrl,
} from '#credential-broker.js';
import {recordCredentialSocketRequest} from '#credential-metrics.js';
import {
  assertCredentialSocketCapability,
  CREDENTIAL_SOCKET_PROTOCOL_VERSION,
  CREDENTIAL_SOCKET_TIMEOUT_HEADROOM_MS,
  CredentialSocketError,
  type CredentialSocketTransportRequest,
  type CredentialSocketTransportResponse,
  type CredentialSocketTransportServer,
  createCredentialSocketTransportServer,
  requestCredentialSocketTransport,
} from '#credential-socket-transport.js';

export {
  assertCredentialSocketCapability,
  CredentialSocketError,
} from '#credential-socket-transport.js';

export type CredentialSocketOperation = 'get' | 'store' | 'erase';

export type CredentialSocketRequest = {
  version: typeof CREDENTIAL_SOCKET_PROTOCOL_VERSION;
  capability: string;
  operation: CredentialSocketOperation;
  repositoryUrl: string;
};

export type CredentialSocketResponse =
  | (CredentialSocketTransportResponse & {ok: true; credential?: CredentialLookup})
  | (CredentialSocketTransportResponse & {ok: false});

export type CredentialSocketServerOptions = {
  socketPath: string;
  capability: string;
  broker: CredentialBroker;
};

export type CredentialSocketServer = CredentialSocketTransportServer;

/** Creates the Git credential adapter over the transport-neutral socket framing. */
export function createCredentialSocketServer(
  options: CredentialSocketServerOptions,
): CredentialSocketServer {
  const transport = createCredentialSocketTransportServer({
    socketPath: options.socketPath,
    capability: options.capability,
    timeoutMs: options.broker.renewalTimeoutMs + CREDENTIAL_SOCKET_TIMEOUT_HEADROOM_MS,
    handleRequest: (request, signal) => handleGitRequest(request, options.broker, signal),
  });
  return {
    socketPath: transport.socketPath,
    start: () => transport.start(),
    close: async () => {
      options.broker.shutdown();
      await transport.close();
    },
  };
}

/** Sends one bounded Git credential request to a job's credential socket. */
export async function requestCredentialSocket(
  socketPath: string,
  request: Omit<CredentialSocketRequest, 'version'>,
): Promise<CredentialSocketResponse> {
  const response = await requestCredentialSocketTransport(socketPath, request, {
    shouldRetry: (_error, _attempt) => request.operation !== 'erase',
  });
  return decodeResponse(response);
}

async function handleGitRequest(
  value: CredentialSocketTransportRequest,
  broker: CredentialBroker,
  signal: AbortSignal,
): Promise<CredentialSocketResponse> {
  let operation: CredentialSocketOperation | 'unknown' = 'unknown';
  try {
    const request = decodeRequest(value);
    operation = request.operation;
    const response = await handleRequest(request, broker, signal);
    if (signal.aborted) return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
    recordCredentialSocketRequest(operation, response.ok ? 'success' : 'rejected');
    return response;
  } catch (error) {
    if (signal.aborted) return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
    recordCredentialSocketRequest(operation, 'error');
    logger().warn(
      {operation, reason: error instanceof Error ? error.name : 'UnknownError'},
      'Credential socket request rejected',
    );
    return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
  }
}

async function handleRequest(
  request: CredentialSocketRequest,
  broker: CredentialBroker,
  signal: AbortSignal,
): Promise<CredentialSocketResponse> {
  if (signal.aborted) return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
  if (request.operation === 'get') {
    const credential = await awaitUnlessCanceled(broker.lookup(request.repositoryUrl), signal);
    return credential === undefined
      ? {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: true}
      : {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: true, credential};
  }
  if (request.operation === 'store') {
    broker.store(request.repositoryUrl);
    return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: true};
  }
  await awaitUnlessCanceled(broker.erase(request.repositoryUrl), signal);
  return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: true};
}

async function awaitUnlessCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const value = await operation;
  if (signal.aborted) {
    throw new CredentialSocketError('Credential socket request was canceled', 'ECANCELED');
  }
  return value;
}

function decodeRequest(value: CredentialSocketTransportRequest): CredentialSocketRequest {
  if (value.operation !== 'get' && value.operation !== 'store' && value.operation !== 'erase') {
    throw new Error('Invalid credential socket request');
  }
  if (
    typeof value.repositoryUrl !== 'string' ||
    value.repositoryUrl.length === 0 ||
    typeof value.capability !== 'string'
  ) {
    throw new Error('Invalid credential socket request');
  }
  assertCredentialSocketCapability(value.capability);
  normalizeRepositoryUrl(value.repositoryUrl);
  return {
    version: CREDENTIAL_SOCKET_PROTOCOL_VERSION,
    operation: value.operation,
    repositoryUrl: value.repositoryUrl,
    capability: value.capability,
  };
}

function decodeResponse(value: CredentialSocketTransportResponse): CredentialSocketResponse {
  if (!value.ok) return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: false};
  if (value.credential === undefined) {
    return {version: CREDENTIAL_SOCKET_PROTOCOL_VERSION, ok: true};
  }
  if (!isRecord(value.credential)) {
    throw new CredentialSocketError('Invalid credential socket response');
  }
  const {username, token} = value.credential;
  if (typeof username !== 'string' || typeof token !== 'string') {
    throw new CredentialSocketError('Invalid credential socket response');
  }
  return {
    version: CREDENTIAL_SOCKET_PROTOCOL_VERSION,
    ok: true,
    credential: {username, token},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
