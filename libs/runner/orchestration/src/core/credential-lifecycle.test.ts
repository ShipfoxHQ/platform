import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {CheckoutTokenResponseDto} from '@shipfox/api-workflows-dto';

const {requestCheckoutTokenMock} = vi.hoisted(() => ({
  requestCheckoutTokenMock: vi.fn(),
}));

vi.mock('@shipfox/runner-protocol', () => ({
  requestCheckoutToken: (...args: unknown[]) => requestCheckoutTokenMock(...args),
  HTTPError: class HTTPError extends Error {
    response: {status: number};

    constructor(status = 500) {
      super(`HTTP ${status}`);
      this.response = {status};
    }
  },
}));

const {createJobCredentialLifecycle} = await import('#core/credential-lifecycle.js');
const {requestCredentialSocket} = await import('@shipfox/runner-workspace');

const REPOSITORY = 'https://github.com/acme/repo.git';
const STEP_ID = '00000000-0000-4000-8000-000000000001';
const LEASE_CLIENT = {} as never;

function checkoutResponse(token: string, generation: string): CheckoutTokenResponseDto {
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
      renewal: {mode: 'on-rejection'},
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
    const clearSecrets = vi.fn();
    const lifecycle = createJobCredentialLifecycle({
      credentialsDir,
      leaseClient: LEASE_CLIENT,
      signal: new AbortController().signal,
      registerSecrets,
      clearSecrets,
    });
    await lifecycle.start();

    lifecycle.register({
      repositoryUrl: REPOSITORY,
      checkoutStepId: STEP_ID,
      checkoutAttempt: 2,
      username: 'x-access-token',
      token: 'initial-token',
      expiresAt: '2030-01-01T00:00:00.000Z',
      generation: 'generation-one',
      renewal: {mode: 'on-rejection'},
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
    expect(registerSecrets).toHaveBeenCalledWith([
      'renewed-token',
      Buffer.from('x-access-token:renewed-token').toString('base64'),
    ]);
    expect(clearSecrets).toHaveBeenCalledTimes(2);
  });
});
