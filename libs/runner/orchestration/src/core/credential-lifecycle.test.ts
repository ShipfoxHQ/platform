import {mkdir, mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';

const {requestCheckoutTokenMock} = vi.hoisted(() => ({
  requestCheckoutTokenMock: vi.fn(),
}));

vi.mock('@shipfox/runner-protocol', () => ({
  requestCheckoutToken: (...args: unknown[]) => requestCheckoutTokenMock(...args),
  isTransientCheckoutTokenError: (error: unknown) =>
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError' || error instanceof TypeError),
  HTTPError: class HTTPError extends Error {
    response: {status: number};

    constructor(status = 500) {
      super(`HTTP ${status}`);
      this.response = {status};
    }
  },
}));

const {createJobCredentialLifecycle} = await import('#core/credential-lifecycle.js');
const {
  requestCredentialSocket,
  runnerFallbackCredentialSocketOwnerPath,
  runnerFallbackCredentialSocketPath,
} = await import('@shipfox/runner-workspace');

const REPOSITORY = 'https://github.com/acme/repo.git';
const STEP_ID = '00000000-0000-4000-8000-000000000001';
const LEASE_CLIENT = {} as never;
type CheckoutRenewal = {mode: 'on-rejection'} | {mode: 'refresh-at'; refresh_at: string};

function checkoutResponse(
  token: string,
  generation: string,
  renewal: CheckoutRenewal = {mode: 'on-rejection'},
): CheckoutTokenResponseDto {
  return {
    repository_url: REPOSITORY,
    ref: 'main',
    fetch_depth: 1,
    auth: {
      kind: 'basic',
      username: 'x-access-token',
      token,
      expires_at: '2030-01-01T00:00:00.000Z',
      generation,
      renewal,
      carry: 'header',
      host: 'github.com',
      persist: true,
    },
  };
}

describe('createJobCredentialLifecycle', () => {
  let credentialsDir: string;

  beforeEach(async () => {
    credentialsDir = await mkdtemp(join(tmpdir(), 'shipfox-credential-lifecycle-test-'));
    await mkdir(credentialsDir, {recursive: true});
    requestCheckoutTokenMock.mockReset();
  });

  afterEach(async () => {
    await rm(credentialsDir, {recursive: true, force: true});
  });

  it('serves a registered checkout and renews the original step after rejection', async () => {
    const registerSecrets = vi.fn();
    const replaceSecrets = vi.fn();
    const clearSecrets = vi.fn();
    const lifecycle = createJobCredentialLifecycle({
      credentialsDir,
      leaseClient: LEASE_CLIENT,
      signal: new AbortController().signal,
      registerSecrets,
      replaceSecrets,
      clearSecrets,
    });
    await lifecycle.start();

    lifecycle.register({
      repositoryUrl: REPOSITORY,
      checkoutStepId: STEP_ID,
      checkoutAttempt: 2,
      credential: {
        username: 'x-access-token',
        token: 'initial-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
        generation: 'generation-one',
        renewal: {mode: 'on-rejection'},
      },
    });
    requestCheckoutTokenMock.mockResolvedValue(checkoutResponse('renewed-token', 'generation-two'));

    await expect(
      requestCredentialSocket(lifecycle.helper.socketPath, {
        operation: 'get',
        repositoryUrl: REPOSITORY,
        capability: lifecycle.helper.capability,
      }),
    ).resolves.toEqual({
      version: 1,
      ok: true,
      credential: {username: 'x-access-token', token: 'initial-token'},
    });

    await expect(
      requestCredentialSocket(lifecycle.helper.socketPath, {
        operation: 'erase',
        repositoryUrl: REPOSITORY,
        capability: lifecycle.helper.capability,
      }),
    ).resolves.toEqual({version: 1, ok: true});
    expect(requestCheckoutTokenMock).toHaveBeenCalledWith(LEASE_CLIENT, {
      stepId: STEP_ID,
      attempt: 2,
      signal: expect.any(AbortSignal),
      rejectedGeneration: 'generation-one',
    });

    await expect(
      requestCredentialSocket(lifecycle.helper.socketPath, {
        operation: 'get',
        repositoryUrl: REPOSITORY,
        capability: lifecycle.helper.capability,
      }),
    ).resolves.toEqual({
      version: 1,
      ok: true,
      credential: {username: 'x-access-token', token: 'renewed-token'},
    });

    await lifecycle.close();

    expect(registerSecrets).toHaveBeenCalledWith([
      'initial-token',
      Buffer.from('x-access-token:initial-token').toString('base64'),
    ]);
    expect(replaceSecrets).toHaveBeenNthCalledWith(1, []);
    expect(replaceSecrets).toHaveBeenNthCalledWith(2, [
      'renewed-token',
      Buffer.from('x-access-token:renewed-token').toString('base64'),
    ]);
    expect(clearSecrets).toHaveBeenCalledTimes(1);
  });

  it('renews a refresh-at credential during a get after its refresh deadline', async () => {
    const replaceSecrets = vi.fn();
    const lifecycle = createJobCredentialLifecycle({
      credentialsDir,
      leaseClient: LEASE_CLIENT,
      signal: new AbortController().signal,
      registerSecrets: vi.fn(),
      replaceSecrets,
      clearSecrets: vi.fn(),
    });
    await lifecycle.start();
    lifecycle.register({
      repositoryUrl: REPOSITORY,
      checkoutStepId: STEP_ID,
      checkoutAttempt: 2,
      credential: {
        username: 'x-access-token',
        token: 'initial-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
        generation: 'generation-one',
        renewal: {mode: 'refresh-at', refreshAt: '2020-01-01T00:00:00.000Z'},
      },
    });
    requestCheckoutTokenMock.mockResolvedValue(
      checkoutResponse('refresh-at-token', 'generation-two', {
        mode: 'refresh-at',
        refresh_at: '2029-12-31T23:00:00.000Z',
      }),
    );

    await expect(
      requestCredentialSocket(lifecycle.helper.socketPath, {
        operation: 'get',
        repositoryUrl: REPOSITORY,
        capability: lifecycle.helper.capability,
      }),
    ).resolves.toMatchObject({credential: {token: 'refresh-at-token'}});
    expect(requestCheckoutTokenMock).toHaveBeenCalledWith(LEASE_CLIENT, {
      stepId: STEP_ID,
      attempt: 2,
      signal: expect.any(AbortSignal),
    });
    expect(replaceSecrets).toHaveBeenCalledWith([
      'refresh-at-token',
      Buffer.from('x-access-token:refresh-at-token').toString('base64'),
    ]);

    await lifecycle.close();
  });

  it('tracks and removes the owner sidecar for a fallback socket path', async () => {
    const credentialsDirWithLongRoot = join(credentialsDir, 'x'.repeat(100));
    const lifecycle = createJobCredentialLifecycle({
      credentialsDir: credentialsDirWithLongRoot,
      leaseClient: LEASE_CLIENT,
      signal: new AbortController().signal,
      registerSecrets: vi.fn(),
      replaceSecrets: vi.fn(),
      clearSecrets: vi.fn(),
    });
    const ownerPath = runnerFallbackCredentialSocketOwnerPath(lifecycle.helper.capability);
    const socketPath = runnerFallbackCredentialSocketPath(lifecycle.helper.capability);

    expect(lifecycle.helper.socketPath).toBe(socketPath);
    await lifecycle.start();
    try {
      await expect(stat(ownerPath)).resolves.toBeDefined();
      await expect(stat(socketPath)).resolves.toBeDefined();
    } finally {
      await lifecycle.close();
    }

    await expect(stat(ownerPath)).rejects.toThrow();
    await expect(stat(socketPath)).rejects.toThrow();
  });

  it('aborts an in-flight renewal before closing the socket', async () => {
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let renewalSignal!: AbortSignal;
    requestCheckoutTokenMock.mockImplementation(
      async (_leaseClient: unknown, params: {signal?: AbortSignal}) => {
        if (params.signal === undefined) throw new Error('Expected a renewal signal');
        renewalSignal = params.signal;
        resolveStarted();
        await new Promise<never>((_resolve, reject) => {
          const abort = () => {
            const error = new Error('renewal aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (params.signal?.aborted) abort();
          else params.signal?.addEventListener('abort', abort, {once: true});
        });
      },
    );
    const lifecycle = createJobCredentialLifecycle({
      credentialsDir,
      leaseClient: LEASE_CLIENT,
      signal: new AbortController().signal,
      registerSecrets: vi.fn(),
      replaceSecrets: vi.fn(),
      clearSecrets: vi.fn(),
    });
    await lifecycle.start();
    lifecycle.register({
      repositoryUrl: REPOSITORY,
      checkoutStepId: STEP_ID,
      checkoutAttempt: 2,
      credential: {
        username: 'x-access-token',
        token: 'initial-token',
        expiresAt: '2030-01-01T00:00:00.000Z',
        generation: 'generation-one',
        renewal: {mode: 'refresh-at', refreshAt: '2020-01-01T00:00:00.000Z'},
      },
    });

    const request = requestCredentialSocket(lifecycle.helper.socketPath, {
      operation: 'get',
      repositoryUrl: REPOSITORY,
      capability: lifecycle.helper.capability,
    });
    const requestFailure = expect(request).rejects.toThrow();
    await started;

    await expect(lifecycle.close()).resolves.toBeUndefined();
    expect(renewalSignal.aborted).toBe(true);
    await requestFailure;
  });
});
