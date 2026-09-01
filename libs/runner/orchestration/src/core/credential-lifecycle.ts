import {randomUUID} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  HTTPError,
  isTransientCheckoutTokenError,
  requestCheckoutToken,
} from '@shipfox/runner-protocol';
import {
  type BrokerCredentialInput,
  type CredentialFailureEvent,
  type CredentialFailureEventSource,
  type CredentialFailureKind,
  createCredentialBroker,
  createCredentialSocketServer,
  type GitCredentialHelperConfig,
  normalizeRepositoryUrl,
  type PersistedCheckoutCredential,
  RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR,
  runnerFallbackCredentialSocketOwnerPath,
  runnerFallbackCredentialSocketPath,
  TransientCredentialRenewalError,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';

const GIT_CREDENTIAL_HELPER_COMMAND = 'git-credential-shipfox';
const MAX_SOCKET_PATH_BYTES = 103;

export interface JobCredentialLifecycle extends CredentialFailureEventSource {
  readonly helper: GitCredentialHelperConfig;
  start(): Promise<void>;
  register(credential: PersistedCheckoutCredential): void;
  close(): Promise<void>;
}

export function createJobCredentialLifecycle(options: {
  credentialsDir: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  registerSecrets: (secrets: string[]) => void;
  replaceSecrets: (secrets: string[]) => void;
  clearSecrets: () => void;
}): JobCredentialLifecycle {
  const capability = randomUUID();
  const socket = credentialSocketPath(options.credentialsDir, capability);
  const renewalController = new AbortController();
  const renewalSignal = AbortSignal.any([options.signal, renewalController.signal]);

  const broker = createCredentialBroker({
    classifyFailure: classifyCredentialFailure,
    renew: async ({repositoryUrl, subject, rejectedGeneration}) => {
      const checkout = parseCheckoutSubject(subject);
      let response: CheckoutTokenResponseDto;
      try {
        response = await requestCheckoutToken(options.leaseClient, {
          stepId: checkout.stepId,
          attempt: checkout.attempt,
          signal: renewalSignal,
          ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
        });
      } catch (error) {
        const failure = renewalError(error);
        logRenewalFailure(checkout, rejectedGeneration, failure);
        throw failure;
      }

      try {
        assertSameRepository(repositoryUrl, response.repository_url);
        return brokerCredentialFromCheckout(response);
      } catch (error) {
        logRenewalFailure(checkout, rejectedGeneration, error);
        throw error;
      }
    },
    publishSecrets: (secrets) => options.registerSecrets([...secrets]),
    replaceSecrets: (secrets) => options.replaceSecrets([...secrets]),
    clearSecrets: options.clearSecrets,
  });

  const socketServer = createCredentialSocketServer({
    socketPath: socket.socketPath,
    capability,
    broker,
  });

  return {
    helper: {
      command: GIT_CREDENTIAL_HELPER_COMMAND,
      socketPath: socket.socketPath,
      capability,
    },
    start: async () => {
      try {
        if (socket.ownerPath !== undefined) await createFallbackSocketOwner(socket.ownerPath);
        await socketServer.start();
      } catch (error) {
        await removeFallbackSocketOwner(socket.ownerPath);
        throw error;
      }
    },
    register(credential) {
      broker.register({
        repositoryUrl: credential.repositoryUrl,
        subject: checkoutSubject(credential.checkoutStepId, credential.checkoutAttempt),
        credential: credential.credential,
      });
      options.registerSecrets([credential.credential.token, basicCredential(credential)]);
    },
    getFailureEventCursor: () => broker.getFailureEventCursor(),
    getFailureEventsSince: (cursor: number): readonly CredentialFailureEvent[] =>
      broker.getFailureEventsSince(cursor),
    close: async () => {
      renewalController.abort();
      try {
        await socketServer.close();
      } finally {
        await removeFallbackSocketOwner(socket.ownerPath);
      }
    },
  };
}

function classifyCredentialFailure(error: unknown): CredentialFailureKind {
  const chain = errorChain(error);
  const httpError = chain.find((cause): cause is HTTPError => cause instanceof HTTPError);
  if (httpError !== undefined) return classifyHttpCredentialFailure(httpError);
  return chain.some((cause) => cause instanceof TransientCredentialRenewalError)
    ? 'unavailable'
    : 'failed';
}

function errorChain(error: unknown): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

function classifyHttpCredentialFailure(error: HTTPError): CredentialFailureKind {
  const {status} = error.response;
  const code = readErrorCode(error);
  if (status === 401 || status === 403 || code === 'access-denied' || code === 'forbidden') {
    return 'auth';
  }
  if (
    status === 429 ||
    status === 503 ||
    code === 'rate-limited' ||
    code === 'timeout' ||
    code === 'provider-unavailable'
  ) {
    return 'unavailable';
  }
  return 'failed';
}

function readErrorCode(error: HTTPError): string | undefined {
  const body = error.data;
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  return undefined;
}

function credentialSocketPath(
  credentialsDir: string,
  capability: string,
): {socketPath: string; ownerPath?: string} {
  const inDirectory = join(credentialsDir, 'credential.sock');
  if (Buffer.byteLength(inDirectory) <= MAX_SOCKET_PATH_BYTES) return {socketPath: inDirectory};

  // Unix-domain sockets have a short platform limit. Keep the usual socket
  // beside the helper config, but use the fixed runner-owned namespace when a
  // configured workspace root makes that path too long. The namespace is
  // swept at startup using the owner sidecar written below.
  const fallback = runnerFallbackCredentialSocketPath(capability);
  return {
    socketPath: fallback,
    ownerPath: runnerFallbackCredentialSocketOwnerPath(capability),
  };
}

async function createFallbackSocketOwner(ownerPath: string): Promise<void> {
  await mkdir(RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR, {recursive: true, mode: 0o700});
  await writeFile(ownerPath, `${process.pid}:${randomUUID()}`, {flag: 'wx', mode: 0o600});
}

async function removeFallbackSocketOwner(ownerPath: string | undefined): Promise<void> {
  if (ownerPath === undefined) return;
  await rm(ownerPath, {force: true});
}

function checkoutSubject(stepId: string, attempt: number): string {
  return `${stepId}:${attempt}`;
}

function parseCheckoutSubject(subject: string): {stepId: string; attempt: number} {
  const separator = subject.lastIndexOf(':');
  const stepId = subject.slice(0, separator);
  const attempt = Number(subject.slice(separator + 1));
  if (separator <= 0 || !Number.isSafeInteger(attempt) || attempt <= 0) {
    throw new TypeError('Invalid checkout credential subject');
  }
  return {stepId, attempt};
}

function brokerCredentialFromCheckout(checkout: CheckoutTokenResponseDto): BrokerCredentialInput {
  const auth = checkout.auth;
  if (auth?.kind !== 'basic' || auth.generation === undefined || auth.renewal === undefined) {
    throw new TypeError('Renewed checkout credential is not renewable');
  }

  return {
    username: auth.username,
    token: auth.token,
    expiresAt: auth.expires_at,
    generation: auth.generation,
    renewal:
      auth.renewal.mode === 'refresh-at'
        ? {mode: 'refresh-at', refreshAt: auth.renewal.refresh_at}
        : {mode: 'on-rejection'},
  };
}

function assertSameRepository(expected: string, actual: string): void {
  if (normalizeRepositoryUrl(expected) !== normalizeRepositoryUrl(actual)) {
    throw new TypeError('Renewed checkout credential changed repository');
  }
}

function basicCredential(credential: PersistedCheckoutCredential): string {
  return Buffer.from(`${credential.credential.username}:${credential.credential.token}`).toString(
    'base64',
  );
}

function renewalError(error: unknown): Error {
  if (error instanceof TransientCredentialRenewalError) return error;
  if (isTransientCheckoutTokenError(error)) {
    return new TransientCredentialRenewalError(
      error instanceof Error ? error.message : String(error),
      {cause: error},
    );
  }
  return error instanceof Error ? error : new Error(String(error), {cause: error});
}

function logRenewalFailure(
  checkout: {stepId: string; attempt: number},
  rejectedGeneration: string | undefined,
  error: unknown,
): void {
  logger().warn(
    {
      stepId: checkout.stepId,
      attempt: checkout.attempt,
      ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
      reason: error instanceof HTTPError ? `HTTP_${error.response.status}` : errorName(error),
    },
    'Checkout credential renewal failed',
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
