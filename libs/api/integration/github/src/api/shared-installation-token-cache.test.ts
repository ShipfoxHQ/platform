import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  backoffActive,
  encodeInstallationTokenEnvelope,
  needsRefresh,
  stillValid,
  TOKEN_REFRESH_MARGIN_MS,
  TOKEN_VALIDITY_BUFFER_MS,
} from './installation-token-envelope.js';
import {
  type InstallationTokenLockResult,
  type InstallationTokenSecretStore,
  SharedInstallationTokenCache,
} from './shared-installation-token-cache.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const installationId = 123;

function token(tokenValue: string, expiresAt = '2026-06-10T12:00:00.000Z') {
  return {token: tokenValue, expiresAt: new Date(expiresAt)};
}

function createStore(): InstallationTokenSecretStore & {
  values: Map<string, string>;
  failWrites: boolean;
  failReads: boolean;
} {
  const values = new Map<string, string>();
  const store = {
    values,
    failWrites: false,
    failReads: false,
    read(readWorkspaceId: string, readInstallationId: number) {
      if (store.failReads) return Promise.reject(new Error('read failed'));
      return Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}`) ?? null);
    },
    write(
      writeWorkspaceId: string,
      writeInstallationId: number,
      envelope: Parameters<InstallationTokenSecretStore['write']>[2],
    ) {
      if (store.failWrites) return Promise.reject(new Error('write failed'));
      values.set(
        `${writeWorkspaceId}:${writeInstallationId}`,
        encodeInstallationTokenEnvelope(envelope),
      );
      return Promise.resolve();
    },
  };
  return store;
}

function cache(
  options: {
    store?: InstallationTokenSecretStore | undefined;
    now?: Date | undefined;
    withLock?:
      | (<T>(
          installationId: number,
          fn: () => Promise<T>,
        ) => Promise<InstallationTokenLockResult<T>>)
      | undefined;
    resolveWorkspaceId?: ((installationId: number) => Promise<string>) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    pollDelaysMs?: number[] | undefined;
  } = {},
) {
  return new SharedInstallationTokenCache({
    secretStore: options.store ?? createStore(),
    withLock: options.withLock ?? (async (_id, fn) => ({acquired: true, value: await fn()})),
    resolveWorkspaceId: options.resolveWorkspaceId ?? (() => Promise.resolve(workspaceId)),
    now: () => options.now ?? new Date('2026-06-10T11:00:00.000Z'),
    sleep: options.sleep ?? (() => Promise.resolve()),
    pollDelaysMs: options.pollDelaysMs ?? [],
  });
}

function setEnvelope(
  store: {values: Map<string, string>},
  envelope: Parameters<typeof encodeInstallationTokenEnvelope>[0],
) {
  store.values.set(`${workspaceId}:${installationId}`, encodeInstallationTokenEnvelope(envelope));
}

describe('SharedInstallationTokenCache', () => {
  it('mints once on a cold winner miss and writes the secret envelope', async () => {
    const store = createStore();
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, mint);

    expect(result).toEqual(token('ghs_new'));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(store.values.get(`${workspaceId}:${installationId}`)).toContain('ghs_new');
  });

  it('shares one mint between two concurrent cache replicas', async () => {
    const store = createStore();
    let lockHeld = false;
    let releaseLock: () => void = () => undefined;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let resolveMintStarted: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      resolveMintStarted = resolve;
    });
    const withLock = async <T>(_id: number, fn: () => Promise<T>) => {
      if (lockHeld) return {acquired: false as const};
      lockHeld = true;
      try {
        return {acquired: true as const, value: await fn()};
      } finally {
        lockHeld = false;
        releaseLock();
      }
    };
    const mint = vi.fn(() => {
      resolveMintStarted();
      return Promise.resolve(token('ghs_shared'));
    });
    const firstReplica = cache({store, withLock});
    const secondReplica = cache({
      store,
      withLock,
      sleep: () => lockReleased,
      pollDelaysMs: [1],
    });

    const first = firstReplica.getOrMint(installationId, mint);
    await mintStarted;
    const second = secondReplica.getOrMint(installationId, mint);
    const results = await Promise.all([first, second]);

    expect(results).toEqual([token('ghs_shared'), token('ghs_shared')]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('returns a warm store hit without minting', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_cached'));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, mint);

    expect(result).toEqual(token('ghs_cached'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('serves a still-valid token on a contended refresh path', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_stale_but_valid', '2026-06-10T11:04:30.000Z'));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
    });

    const result = await shared.getOrMint(installationId, mint);

    expect(result).toEqual(token('ghs_stale_but_valid', '2026-06-10T11:04:30.000Z'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('polls for the winner commit on a contended cold miss', async () => {
    const store = createStore();
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    let polls = 0;
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
      pollDelaysMs: [1, 1],
      sleep: () => {
        polls += 1;
        if (polls === 1) setEnvelope(store, token('ghs_committed'));
        return Promise.resolve();
      },
    });

    const result = await shared.getOrMint(installationId, mint);

    expect(result).toEqual(token('ghs_committed'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('refreshes a near-expiry token and clears backoff', async () => {
    const store = createStore();
    setEnvelope(store, {
      ...token('ghs_old', '2026-06-10T11:04:00.000Z'),
      backoffUntil: new Date('2026-06-10T10:00:00.000Z'),
      backoffReason: 'rate-limited',
    });
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new')));

    expect(result).toEqual(token('ghs_new'));
    expect(store.values.get(`${workspaceId}:${installationId}`)).not.toContain('backoff');
  });

  it('records transient backoff and short-circuits the next call with the stored reason', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'rate-limited',
    });
    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'rate-limited',
      retryAfterSeconds: 42,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('records terminal backoff without hiding access denied as provider unavailable', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('access-denied', 'denied'));
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'access-denied',
    });
    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'access-denied',
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('preserves terminal provider rejection details through backoff', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(
        new GithubIntegrationProviderError(
          'provider-rejected',
          'commit_id is missing',
          undefined,
          422,
        ),
      );
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });
    await expect(shared.getOrMint(installationId, mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('serves stale when refresh minting fails while the token is still valid', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, () =>
      Promise.reject(new GithubIntegrationProviderError('provider-unavailable', 'down')),
    );

    expect(result).toEqual(token('ghs_existing', '2026-06-10T11:04:30.000Z'));
  });

  it('does not serve stale when refresh minting fails with a terminal reason', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, () =>
        Promise.reject(new GithubIntegrationProviderError('access-denied', 'denied')),
      ),
    ).rejects.toMatchObject({reason: 'access-denied'});
  });

  it('does not serve stale from active terminal backoff on a contended refresh', async () => {
    const store = createStore();
    setEnvelope(store, {
      ...token('ghs_existing', '2026-06-10T11:04:30.000Z'),
      backoffUntil: new Date('2026-06-10T11:15:00.000Z'),
      backoffReason: 'installation-not-found',
    });
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
    });

    await expect(
      shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new'))),
    ).rejects.toMatchObject({reason: 'installation-not-found'});
  });

  it('returns a minted token when the cache read fails', async () => {
    const store = createStore();
    store.failReads = true;
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new')));

    expect(result).toEqual(token('ghs_new'));
  });

  it('returns a minted token when the cache write fails', async () => {
    const store = createStore();
    store.failWrites = true;
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new')));

    expect(result).toEqual(token('ghs_new'));
  });

  it('treats an invalid envelope as a miss and overwrites it', async () => {
    const store = createStore();
    store.values.set(`${workspaceId}:${installationId}`, '{bad json');
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new')));

    expect(result).toEqual(token('ghs_new'));
    expect(store.values.get(`${workspaceId}:${installationId}`)).toContain('ghs_new');
  });

  it('surfaces an unresolvable installation as installation-not-found', async () => {
    const shared = cache({
      resolveWorkspaceId: () =>
        Promise.reject(new GithubIntegrationProviderError('installation-not-found', 'missing')),
    });

    await expect(
      shared.getOrMint(installationId, () => Promise.resolve(token('ghs_new'))),
    ).rejects.toMatchObject({reason: 'installation-not-found'});
  });
});

describe('installation token envelope predicates', () => {
  it('uses exact refresh, validity, and backoff boundaries', () => {
    const now = new Date('2026-06-10T11:00:00.000Z');

    expect(needsRefresh(new Date(now.getTime() + TOKEN_REFRESH_MARGIN_MS), now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() + TOKEN_REFRESH_MARGIN_MS + 1), now)).toBe(false);
    expect(stillValid(new Date(now.getTime() + TOKEN_VALIDITY_BUFFER_MS), now)).toBe(false);
    expect(stillValid(new Date(now.getTime() + TOKEN_VALIDITY_BUFFER_MS + 1), now)).toBe(true);
    expect(
      backoffActive(
        {
          backoffUntil: now,
          backoffReason: 'provider-unavailable',
        },
        now,
      ),
    ).toBe(false);
    expect(
      backoffActive(
        {
          backoffUntil: new Date(now.getTime() + 1),
          backoffReason: 'provider-unavailable',
        },
        now,
      ),
    ).toBe(true);
  });
});
