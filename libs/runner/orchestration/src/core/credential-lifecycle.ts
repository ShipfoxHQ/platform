import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';
import type {PersistedCheckoutCredential} from '@shipfox/runner-execution';
import {HTTPError, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  type BrokerCredentialInput,
  createCredentialBroker,
  createCredentialSocketServer,
  type GitCredentialHelperConfig,
  normalizeRepositoryUrl,
  TransientCredentialRenewalError,
} from '@shipfox/runner-workspace';
import {isTimeoutError, type KyInstance} from 'ky';

const GIT_CREDENTIAL_HELPER_COMMAND = 'git-credential-shipfox';
const MAX_SOCKET_PATH_BYTES = 103;

export interface JobCredentialLifecycle {
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
  clearSecrets: () => void;
}): JobCredentialLifecycle {
  const capability = randomUUID();
  const socketPath = credentialSocketPath(options.credentialsDir, capability);

  const broker = createCredentialBroker({
    renew: async ({repositoryUrl, subject, rejectedGeneration}) => {
      const checkout = parseCheckoutSubject(subject);
      let response: CheckoutTokenResponseDto;
      try {
        response = await requestCheckoutToken(options.leaseClient, {
          stepId: checkout.stepId,
          attempt: checkout.attempt,
          signal: options.signal,
          ...(rejectedGeneration === undefined ? {} : {rejectedGeneration}),
        });
      } catch (error) {
        throw renewalError(error);
      }

      assertSameRepository(repositoryUrl, response.repository_url);
      return brokerCredentialFromCheckout(response);
    },
    publishSecrets: (secrets) => options.registerSecrets([...secrets]),
    clearSecrets: options.clearSecrets,
  });

  const socketServer = createCredentialSocketServer({
    socketPath,
    capability,
    broker,
  });

  return {
    helper: {
      command: GIT_CREDENTIAL_HELPER_COMMAND,
      socketPath,
      capability,
    },
    start: () => socketServer.start(),
    register(credential) {
      broker.register({
        repositoryUrl: credential.repositoryUrl,
        subject: checkoutSubject(credential.checkoutStepId, credential.checkoutAttempt),
        credential: {
          username: credential.username,
          token: credential.token,
          expiresAt: credential.expiresAt,
          generation: credential.generation,
          renewal:
            credential.renewal.mode === 'refresh-at'
              ? {mode: 'refresh-at', refreshAt: credential.renewal.refreshAt}
              : {mode: 'on-rejection'},
        },
      });
      options.registerSecrets([credential.token, basicCredential(credential)]);
    },
    close: () => socketServer.close(),
  };
}

function credentialSocketPath(credentialsDir: string, capability: string): string {
  const inDirectory = join(credentialsDir, 'credential.sock');
  if (Buffer.byteLength(inDirectory) <= MAX_SOCKET_PATH_BYTES) return inDirectory;

  // Unix-domain sockets have a short platform limit. Keep the usual socket
  // beside the helper config, but fall back to a capability-derived temporary
  // name when a configured workspace root makes that path too long.
  const inTempDirectory = join(tmpdir(), `shipfox-${capability}.sock`);
  if (Buffer.byteLength(inTempDirectory) <= MAX_SOCKET_PATH_BYTES) return inTempDirectory;
  return join('/tmp', `shipfox-${capability}.sock`);
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
  return Buffer.from(`${credential.username}:${credential.token}`).toString('base64');
}

function renewalError(error: unknown): Error {
  if (error instanceof TransientCredentialRenewalError) return error;
  if (
    (error instanceof HTTPError &&
      [408, 429, 500, 502, 503, 504].includes(error.response.status)) ||
    isTimeoutError(error) ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    error instanceof TypeError
  ) {
    return new TransientCredentialRenewalError();
  }
  return error instanceof Error ? error : new Error(String(error));
}
