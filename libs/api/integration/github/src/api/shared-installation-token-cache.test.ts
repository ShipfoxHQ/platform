import {GithubIntegrationProviderError} from '#core/errors.js';
import {
  backoffActive,
  encodeInstallationTokenEnvelope,
  githubInstallationTokenNamespace,
  needsRefresh,
  parseInstallationTokenEnvelope,
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
} {
  const values = new Map<string, string>();
  const store = {
    values,
    failWrites: false,
    read(readWorkspaceId: string, readInstallationId: number) {
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
          scopeKey: string | undefined,
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
    withLock:
      options.withLock ?? (async (_id, _scopeKey, fn) => ({acquired: true, value: await fn()})),
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

function tieredSecretKey(
  keyWorkspaceId: string,
  keyInstallationId: number,
  scopeKey: string | undefined,
): string {
  return scopeKey === undefined
    ? `${keyWorkspaceId}:${keyInstallationId}`
    : `${keyWorkspaceId}:${githubInstallationTokenNamespace(keyInstallationId, scopeKey)}`;
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

  it('keys the mint lock by scope so scoped mints serialize per scope', async () => {
    const lockScopeKeys: Array<string | undefined> = [];
    const values = new Map<string, string>();
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) =>
        Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        ),
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    const shared = cache({
      store,
      withLock: async <T>(_id: number, scopeKey: string | undefined, fn: () => Promise<T>) => {
        lockScopeKeys.push(scopeKey);
        return {acquired: true as const, value: await fn()};
      },
    });

    await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_broad')));
    await shared.getOrMint(installationId, () => Promise.resolve(token('ghs_scoped')), {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });

    expect(lockScopeKeys).toEqual([undefined, '456/contents-write']);
  });

  it('isolates a repo-specific scoped backoff from the broad envelope', async () => {
    const values = new Map<string, string>();
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) =>
        Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        ),
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    const scopedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('access-denied', 'not accessible'));
    const broadMint = vi.fn(() => Promise.resolve(token('ghs_broad')));
    const shared = cache({store});

    // A scoped mint failure records its backoff under the scoped key only; the
    // repo-specific denial does not poison the installation-wide envelope.
    await expect(
      shared.getOrMint(installationId, scopedMint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'access-denied'});
    expect(
      values.get(tieredSecretKey(workspaceId, installationId, '456/contents-write')),
    ).toContain('backoff');
    expect(values.get(tieredSecretKey(workspaceId, installationId, undefined))).toBeUndefined();

    // A subsequent unscoped request mints a fresh broad token, unaffected by the
    // repo-specific scoped backoff.
    const broad = await shared.getOrMint(installationId, broadMint);
    expect(broad).toEqual(token('ghs_broad'));

    // The same scope is still backed off with its stored reason.
    await expect(
      shared.getOrMint(installationId, scopedMint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'access-denied'});
    expect(scopedMint).toHaveBeenCalledTimes(1);
    expect(broadMint).toHaveBeenCalledTimes(1);
  });

  it('mirrors an installation-wide scoped backoff onto the broad envelope', async () => {
    const values = new Map<string, string>();
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) =>
        Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        ),
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    const scopedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const broadMint = vi.fn(() => Promise.resolve(token('ghs_broad')));
    const shared = cache({store});

    // A transient scoped mint failure records its backoff under the scoped key and
    // mirrors it onto the installation-wide envelope.
    await expect(
      shared.getOrMint(installationId, scopedMint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 42});
    expect(
      values.get(tieredSecretKey(workspaceId, installationId, '456/contents-write')),
    ).toContain('backoff');
    expect(values.get(tieredSecretKey(workspaceId, installationId, undefined))).toContain(
      'backoff',
    );

    // A subsequent unscoped request is short-circuited by the installation-wide
    // backoff instead of retrying the shared rate limit.
    await expect(shared.getOrMint(installationId, broadMint)).rejects.toMatchObject({
      reason: 'rate-limited',
      retryAfterSeconds: 42,
    });
    expect(broadMint).not.toHaveBeenCalled();
    expect(scopedMint).toHaveBeenCalledTimes(1);
  });

  it('re-reads the broad envelope when mirroring so a concurrent broad mint is not clobbered', async () => {
    const values = new Map<string, string>();
    let broadReads = 0;
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) => {
        if (readScopeKey === undefined) {
          // First broad read happens before the scoped mint (empty envelope); a
          // concurrent unscoped mint writes a fresh broad token before the mirror
          // re-reads it after the scoped mint fails.
          broadReads += 1;
          return broadReads === 1
            ? Promise.resolve(null)
            : Promise.resolve(encodeInstallationTokenEnvelope(token('ghs_broad_fresh')));
        }
        return Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        );
      },
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    const scopedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, scopedMint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 42});

    // The mirror merged the backoff onto the fresh broad token instead of
    // overwriting it with the pre-mint snapshot, so an unscoped caller still
    // serves the freshly minted broad token.
    const broadEnvelope = parseInstallationTokenEnvelope(
      values.get(tieredSecretKey(workspaceId, installationId, undefined)) ?? '',
    );
    expect(broadEnvelope?.token).toBe('ghs_broad_fresh');
    expect(broadEnvelope?.backoffReason).toBe('rate-limited');
  });

  it('does not shorten a newer broad backoff recorded while a scoped mint was in flight', async () => {
    const values = new Map<string, string>();
    let broadReads = 0;
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) => {
        if (readScopeKey === undefined) {
          // The pre-mint consult sees no active broad backoff; before the mirror
          // re-reads, another failure records a longer installation-wide backoff.
          broadReads += 1;
          return broadReads === 1
            ? Promise.resolve(null)
            : Promise.resolve(
                encodeInstallationTokenEnvelope({
                  backoffUntil: new Date('2026-06-10T12:00:00.000Z'),
                  backoffReason: 'provider-unavailable',
                }),
              );
        }
        return Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        );
      },
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    const scopedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, scopedMint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'rate-limited', retryAfterSeconds: 42});

    // The later backoff deadline (and its reason) survives the mirror write.
    const broadEnvelope = parseInstallationTokenEnvelope(
      values.get(tieredSecretKey(workspaceId, installationId, undefined)) ?? '',
    );
    expect(broadEnvelope?.backoffUntil?.toISOString()).toBe('2026-06-10T12:00:00.000Z');
    expect(broadEnvelope?.backoffReason).toBe('provider-unavailable');
  });

  it('treats an envelope recorded for another scope as a cache miss', async () => {
    const values = new Map<string, string>();
    const store: InstallationTokenSecretStore = {
      read: (readWorkspaceId, readInstallationId, readScopeKey) =>
        Promise.resolve(
          values.get(tieredSecretKey(readWorkspaceId, readInstallationId, readScopeKey)) ?? null,
        ),
      write: (writeWorkspaceId, writeInstallationId, envelope, writeScopeKey) => {
        values.set(
          tieredSecretKey(writeWorkspaceId, writeInstallationId, writeScopeKey),
          encodeInstallationTokenEnvelope(envelope),
        );
        return Promise.resolve();
      },
    };
    // Seed the scoped slot with an envelope that carries no scope stamp, as a store
    // that ignores the scopeKey argument (older @shipfox/api-integration-core release
    // or a custom store) would leave behind.
    values.set(
      tieredSecretKey(workspaceId, installationId, '456/contents-write'),
      encodeInstallationTokenEnvelope({
        token: 'ghs_wrong_scope',
        expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      }),
    );
    const mint = vi.fn(() => Promise.resolve(token('ghs_scoped')));
    const shared = cache({store});

    const result = await shared.getOrMint(installationId, mint, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });

    expect(result).toEqual(token('ghs_scoped'));
    expect(mint).toHaveBeenCalledTimes(1);
    // The replacement envelope is stamped with its scope, so the next same-scope
    // request is served from the store instead of minting again.
    const again = await shared.getOrMint(installationId, mint, {
      repositoryId: 456,
      permissions: {contents: 'write'},
    });
    expect(again).toEqual(token('ghs_scoped'));
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('short-circuits a scoped mint on an installation-wide backoff', async () => {
    const store = createStore();
    setEnvelope(store, {
      backoffUntil: new Date('2026-06-10T11:15:00.000Z'),
      backoffReason: 'rate-limited',
    });
    const mint = vi.fn(() => Promise.resolve(token('ghs_scoped')));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, mint, {
        repositoryId: 456,
        permissions: {contents: 'write'},
      }),
    ).rejects.toMatchObject({reason: 'rate-limited'});

    expect(mint).not.toHaveBeenCalled();
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
