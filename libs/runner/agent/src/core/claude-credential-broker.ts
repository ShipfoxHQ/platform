import {randomUUID} from 'node:crypto';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import type {CredentialSocketTransportRequest} from '@shipfox/runner-workspace';
import {
  CredentialSocketError,
  createCredentialSocketTransportServer,
  MAX_CREDENTIAL_SOCKET_PATH_BYTES,
  RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR,
  runnerFallbackCredentialSocketOwnerPath,
  runnerFallbackCredentialSocketPath,
} from '@shipfox/runner-workspace';
import type {InferenceCredential, InferenceCredentialSource} from '#core/harness.js';

export const CLAUDE_CREDENTIAL_SOCKET_ENV = 'SHIPFOX_CLAUDE_CREDENTIAL_SOCKET';
export const CLAUDE_CREDENTIAL_CAPABILITY_ENV = 'SHIPFOX_CLAUDE_CREDENTIAL_CAPABILITY';
export const CLAUDE_CREDENTIAL_TIMEOUT_ENV = 'SHIPFOX_CLAUDE_CREDENTIAL_TIMEOUT_MS';

/** Claude Code's helper cache interval. The broker renews before this expires on rejection. */
export const CLAUDE_CREDENTIAL_HELPER_TTL_MS = 120_000;

/** Keep helper calls below Claude Code's ten-second slow-helper notice. */
export const CLAUDE_CREDENTIAL_HELPER_TIMEOUT_MS = 9_000;

export interface ClaudeCredentialBroker {
  readonly socketPath: string;
  readonly capability: string;
  start(): Promise<void>;
  close(): Promise<void>;
}

export function createClaudeCredentialBroker(options: {
  readonly credentialSource: InferenceCredentialSource;
  readonly signal: AbortSignal;
  readonly socketDirectory: string;
  readonly monotonicNow?: () => number;
}): ClaudeCredentialBroker {
  const capability = randomUUID();
  const localSocketPath = join(options.socketDirectory, `claude-credential-${capability}.sock`);
  const usesFallbackSocket =
    Buffer.byteLength(localSocketPath, 'utf8') > MAX_CREDENTIAL_SOCKET_PATH_BYTES;
  const socketPath = usesFallbackSocket
    ? runnerFallbackCredentialSocketPath(capability)
    : localSocketPath;
  const ownerPath = usesFallbackSocket
    ? runnerFallbackCredentialSocketOwnerPath(capability)
    : undefined;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  let current: InferenceCredential | undefined;
  let nextRefreshAt = 0;
  let credentialFlight: Promise<InferenceCredential> | undefined;
  let started = false;
  let closed = false;
  let ownerCreated = false;
  let closeFlight: Promise<void> | undefined;

  const transport = createCredentialSocketTransportServer({
    socketPath,
    capability,
    timeoutMs: CLAUDE_CREDENTIAL_HELPER_TIMEOUT_MS,
    handleRequest,
  });

  async function handleRequest(request: CredentialSocketTransportRequest, signal: AbortSignal) {
    if (request.operation !== 'get') return {ok: false, code: 'unsupported-operation'};
    try {
      return await resolveCredentialForRequest(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      logger().warn(
        {reason: error instanceof Error ? error.name : 'UnknownError'},
        'Claude credential helper request failed',
      );
      return {ok: false, code: 'credential-unavailable'};
    }
  }

  async function resolveCredentialForRequest(signal: AbortSignal) {
    const startedAt = monotonicNow();
    const rejectedGeneration =
      current !== undefined && startedAt < nextRefreshAt ? current.generation : undefined;
    const previousGeneration = current?.generation;
    const credential = await awaitUnlessCanceled(resolveCredential(rejectedGeneration), signal);
    if (credential.token.length === 0 || credential.generation.length === 0) {
      throw new Error('Resolved Claude credential was incomplete');
    }

    current = credential;
    if (previousGeneration === undefined || credential.generation !== previousGeneration) {
      nextRefreshAt = monotonicNow() + CLAUDE_CREDENTIAL_HELPER_TTL_MS;
    }
    return {ok: true, token: credential.token};
  }

  const broker: ClaudeCredentialBroker = {
    socketPath,
    capability,
    start: async () => {
      if (started) return;
      if (closed || options.signal.aborted) {
        throw new CredentialSocketError('Claude credential broker is closed', 'ECANCELED');
      }

      try {
        if (ownerPath !== undefined) {
          await mkdir(RUNNER_FALLBACK_CREDENTIAL_SOCKET_DIR, {recursive: true, mode: 0o700});
          await writeFile(ownerPath, `${process.pid}:${randomUUID()}`, {
            flag: 'wx',
            mode: 0o600,
          });
          ownerCreated = true;
        }
        await transport.start();
        started = true;
      } catch (error) {
        await transport.close().catch(() => undefined);
        await removeOwnedSocket();
        throw error;
      }
    },
    close: () => {
      if (closeFlight !== undefined) return closeFlight;
      closeFlight = closeBroker();
      return closeFlight;
    },
  };

  const closeOnAbort = () => {
    void broker.close().catch((error) => {
      logger().warn(
        {reason: error instanceof Error ? error.name : 'UnknownError'},
        'Claude credential broker cleanup failed',
      );
    });
  };
  options.signal.addEventListener('abort', closeOnAbort, {once: true});
  if (options.signal.aborted) closeOnAbort();

  return broker;

  function resolveCredential(rejectedGeneration: string | undefined): Promise<InferenceCredential> {
    if (credentialFlight !== undefined) return credentialFlight;

    const next = Promise.resolve().then(() =>
      rejectedGeneration === undefined
        ? options.credentialSource.resolve()
        : options.credentialSource.resolve({rejectedGeneration}),
    );
    const flight = next.finally(() => {
      if (credentialFlight === flight) credentialFlight = undefined;
    });
    credentialFlight = flight;
    void flight.catch(() => undefined);
    return flight;
  }

  async function closeBroker(): Promise<void> {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener('abort', closeOnAbort);
    try {
      await transport.close();
    } finally {
      started = false;
      await removeOwnedSocket();
    }
  }

  async function removeOwnedSocket(): Promise<void> {
    const removals = [rm(socketPath, {force: true})];
    if (ownerCreated && ownerPath !== undefined) {
      removals.push(rm(ownerPath, {force: true}));
    }
    await Promise.allSettled(removals);
    ownerCreated = false;
  }
}

export function claudeCredentialHelperEnvironment(
  broker: Pick<ClaudeCredentialBroker, 'socketPath' | 'capability'>,
): Record<string, string> {
  return {
    [CLAUDE_CREDENTIAL_SOCKET_ENV]: broker.socketPath,
    [CLAUDE_CREDENTIAL_CAPABILITY_ENV]: broker.capability,
    [CLAUDE_CREDENTIAL_TIMEOUT_ENV]: String(CLAUDE_CREDENTIAL_HELPER_TIMEOUT_MS),
  };
}

function awaitUnlessCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  void operation.catch(() => undefined);
  if (signal.aborted) {
    throw new CredentialSocketError('Claude credential request was canceled', 'ECANCELED');
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() =>
        reject(new CredentialSocketError('Claude credential request was canceled', 'ECANCELED')),
      );

    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) {
      onAbort();
      return;
    }
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
