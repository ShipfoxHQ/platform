import {GithubIntegrationProviderError} from '#core/errors.js';
import type {
  GithubCheckoutTokenEnvelope,
  GithubCheckoutTokenSecretStore,
} from './github-checkout-token-cache.js';
import {
  encodeGithubCheckoutTokenEnvelope,
  GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
  GithubCheckoutTokenCache,
  type GithubCheckoutTokenScope,
  githubCheckoutTokenStorageKey,
  parseGithubCheckoutTokenEnvelope,
} from './github-checkout-token-cache.js';

const now = new Date('2026-06-10T11:00:00.000Z');
const baseScope: GithubCheckoutTokenScope = {
  workspaceId: 'workspace-a',
  providerInstance: 'provider-a',
  installationId: 11,
  repositoryId: 42,
  permissions: {contents: 'read'},
};

function token(
  value: string,
  generation?: string,
  expiresAt = '2026-06-10T12:00:00.000Z',
  permissions: Record<string, 'read' | 'write'> = {contents: 'read'},
) {
  return {
    token: value,
    expiresAt: new Date(expiresAt),
    permissions,
    ...(generation === undefined ? {} : {generation}),
  };
}

function createStore() {
  const values = new Map<string, string>();
  const store: GithubCheckoutTokenSecretStore & {values: Map<string, string>} = {
    values,
    read: ({key}) => Promise.resolve(values.get(key) ?? null),
    write: ({key, value}) => {
      values.set(key, value);
      return Promise.resolve();
    },
    delete: ({key}) => {
      values.delete(key);
      return Promise.resolve();
    },
    list: () => Promise.resolve(Object.fromEntries(values)),
    deleteNamespace: () => {
      const count = values.size;
      values.clear();
      return Promise.resolve(count);
    },
  };
  return store;
}

function cache(
  options: {
    store?: GithubCheckoutTokenSecretStore;
    withLock?: GithubCheckoutTokenCacheOptions['withLock'];
    maxRamEntries?: number;
    mintTimeoutMs?: number;
    currentTime?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  return new GithubCheckoutTokenCache({
    secretStore: options.store,
    withLock: options.withLock ?? (async (_digest, fn) => ({acquired: true, value: await fn()})),
    now: options.currentTime ?? (() => now),
    sleep: options.sleep ?? (() => Promise.resolve()),
    pollDelaysMs: [1],
    maxRamEntries: options.maxRamEntries,
    mintTimeoutMs: options.mintTimeoutMs,
  });
}

type GithubCheckoutTokenCacheOptions = NonNullable<
  ConstructorParameters<typeof GithubCheckoutTokenCache>[0]
>;

describe('GitHub checkout token scope identity', () => {
  it('splits every authority-bearing scope component and ignores execution details', () => {
    const sameScope = {
      ...baseScope,
      permissions: {contents: 'read' as const},
    };
    expect(githubCheckoutTokenStorageKey(baseScope)).toBe(githubCheckoutTokenStorageKey(sameScope));

    for (const changed of [
      {...baseScope, workspaceId: 'workspace-b'},
      {...baseScope, providerInstance: 'provider-b'},
      {...baseScope, installationId: 12},
      {...baseScope, repositoryId: 43},
      {...baseScope, permissions: {contents: 'write' as const}},
    ]) {
      expect(githubCheckoutTokenStorageKey(changed)).not.toBe(
        githubCheckoutTokenStorageKey(baseScope),
      );
    }
  });

  it('does not put branch, job, step, or runner data in the identity', () => {
    expect(githubCheckoutTokenStorageKey(baseScope)).toBe(
      githubCheckoutTokenStorageKey({
        ...baseScope,
        ref: 'feature/x',
        jobId: 'job',
        runnerId: 'runner',
      } as GithubCheckoutTokenScope),
    );
  });

  it('requires the versioned envelope and exact stored permissions', () => {
    const envelope: GithubCheckoutTokenEnvelope = {
      version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
      generation: 'generation-a',
      token: 'token-a',
      expiresAt: new Date('2026-06-10T12:00:00.000Z'),
      repositoryId: 42,
      permissions: {contents: 'read'},
    };
    const encoded = encodeGithubCheckoutTokenEnvelope(envelope);

    expect(parseGithubCheckoutTokenEnvelope(encoded)).toEqual(envelope);
    expect(
      parseGithubCheckoutTokenEnvelope(encoded.replace('"version":1', '"version":2')),
    ).toBeUndefined();
  });
});

describe('GithubCheckoutTokenCache', () => {
  it('coalesces one exact-scope mint across replicas after lock contention', async () => {
    const store = createStore();
    let held = false;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resolveMint: (value: {token: string; expiresAt: Date}) => void = () => undefined;
    const mintDone = new Promise<{token: string; expiresAt: Date}>((resolve) => {
      resolveMint = resolve;
    });
    const withLock: GithubCheckoutTokenCacheOptions['withLock'] = async (_digest, fn) => {
      if (held) return {acquired: false};
      held = true;
      try {
        return {acquired: true, value: await fn()};
      } finally {
        held = false;
        release();
      }
    };
    const mint = vi.fn(() => mintDone);
    const first = cache({store, withLock});
    const second = cache({store, withLock, sleep: () => released});

    const winner = first.getOrMint(baseScope, mint);
    await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
    const contender = second.getOrMint(baseScope, mint);
    resolveMint(token('token-a'));
    await released;

    await expect(Promise.all([winner, contender])).resolves.toEqual([
      {token: 'token-a', expiresAt: token('token-a').expiresAt, generation: expect.any(String)},
      {token: 'token-a', expiresAt: token('token-a').expiresAt, generation: expect.any(String)},
    ]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('does not return a rejected generation from an in-flight ordinary refresh', async () => {
    let currentTime = now;
    const shared = cache({currentTime: () => currentTime});
    const existing = await shared.getOrMint(baseScope, () => Promise.resolve(token('token-a')));
    currentTime = new Date('2026-06-10T11:55:00.000Z');
    let rejectRefresh: (reason?: unknown) => void = () => undefined;
    const refreshResult = new Promise<never>((_, reject) => {
      rejectRefresh = reject;
    });
    const refresh = vi.fn(() => refreshResult);

    const ordinaryRefresh = shared.getOrMint(baseScope, refresh);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const rejectedRefresh = shared.getOrMint(baseScope, refresh, existing.generation);
    rejectRefresh(new GithubIntegrationProviderError('provider-unavailable', 'down'));

    await expect(ordinaryRefresh).resolves.toEqual({...existing, stale: true});
    await expect(rejectedRefresh).rejects.toMatchObject({reason: 'provider-unavailable'});
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never shares read and write permission entries', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockResolvedValueOnce(token('read-token'))
      .mockResolvedValueOnce(
        token('write-token', undefined, '2026-06-10T12:00:00.000Z', {contents: 'write'}),
      );
    const shared = cache({store});

    const read = await shared.getOrMint(baseScope, mint);
    const write = await shared.getOrMint({...baseScope, permissions: {contents: 'write'}}, mint);

    expect(read.token).toBe('read-token');
    expect(write.token).toBe('write-token');
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('does not evict a newer generation after a stale rejection', async () => {
    const store = createStore();
    const shared = cache({store});
    const newer = await shared.getOrMint(baseScope, () => Promise.resolve(token('token-b')));

    const result = await shared.getOrMint(
      baseScope,
      () => Promise.reject(new Error('must not mint')),
      'generation-a',
    );

    expect(result).toEqual(newer);
    expect(store.values.get(githubCheckoutTokenStorageKey(baseScope))).toContain('token-b');
  });

  it('refreshes a rejected current generation once and guards duplicate reports', async () => {
    const store = createStore();
    const shared = cache({store});
    const first = await shared.getOrMint(baseScope, () => Promise.resolve(token('token-a')));
    const mint = vi.fn(() => Promise.resolve(token('token-b')));

    const replacement = await shared.getOrMint(baseScope, mint, first.generation);
    expect(replacement.generation).not.toBe(first.generation);
    await expect(shared.getOrMint(baseScope, mint, replacement.generation)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('accepts a provider response without permissions', async () => {
    const shared = cache();

    await expect(
      shared.getOrMint(baseScope, () =>
        Promise.resolve({...token('token-a'), permissions: undefined}),
      ),
    ).resolves.toMatchObject({token: 'token-a'});
  });

  it('rejects a provider response for another repository or permission scope', async () => {
    const shared = cache();

    await expect(
      shared.getOrMint(baseScope, () =>
        Promise.resolve({...token('token-a'), repositoryIds: [43]}),
      ),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    await expect(
      shared.getOrMint({...baseScope, permissions: {contents: 'write' as const}}, () =>
        Promise.resolve({...token('token-b'), permissions: {contents: 'read'}}),
      ),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
  });

  it('serves a still-valid stale token after a transient failure and backs off', async () => {
    let currentTime = now;
    const store = createStore();
    const shared = cache({store, currentTime: () => currentTime});
    const existing = await shared.getOrMint(baseScope, () => Promise.resolve(token('token-a')));
    currentTime = new Date('2026-06-10T11:55:00.000Z');
    const refresh = vi.fn(() =>
      Promise.reject(new GithubIntegrationProviderError('provider-unavailable', 'down')),
    );

    const result = await shared.getOrMint(baseScope, refresh);

    expect(result.token).toBe('token-a');
    expect(result.stale).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(existing.generation).toBeDefined();
    const backedOff = parseGithubCheckoutTokenEnvelope(
      store.values.get(githubCheckoutTokenStorageKey(baseScope)) ?? '',
    );
    expect(backedOff?.backoffReason).toBe('provider-unavailable');
    expect(backedOff?.backoffUntil).toBeDefined();

    const ordinaryRetry = await shared.getOrMint(baseScope, refresh);
    expect(ordinaryRetry.token).toBe('token-a');
    expect(ordinaryRetry.stale).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    await expect(shared.getOrMint(baseScope, refresh, existing.generation)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('times out a hanging mint', async () => {
    const shared = cache({mintTimeoutMs: 1});

    await expect(
      shared.getOrMint(baseScope, () => new Promise(() => undefined)),
    ).rejects.toMatchObject({reason: 'timeout'});
  });

  it('does not wait for or repopulate an installation after deleting a timed-out mint', async () => {
    const store = createStore();
    let resolveMint: (value: {token: string; expiresAt: Date}) => void = () => undefined;
    const lateMint = new Promise<{token: string; expiresAt: Date}>((resolve) => {
      resolveMint = resolve;
    });
    const shared = cache({store, mintTimeoutMs: 1});

    await expect(shared.getOrMint(baseScope, () => lateMint)).rejects.toMatchObject({
      reason: 'timeout',
    });
    const deletion = shared.deleteInstallation('workspace-a', 'provider-a', 11);

    await expect(deletion).resolves.toBe(1);
    expect(store.values.size).toBe(0);
    await expect(
      shared.getOrMint(baseScope, () => Promise.resolve(token('fresh-token'))),
    ).resolves.toMatchObject({token: 'fresh-token'});

    resolveMint(token('late-token'));
    await Promise.resolve();
    expect(
      parseGithubCheckoutTokenEnvelope(
        store.values.get(githubCheckoutTokenStorageKey(baseScope)) ?? '',
      )?.token,
    ).toBe('fresh-token');
  });

  it('isolates late-mint tombstones by workspace', async () => {
    const shared = cache({mintTimeoutMs: 1});
    const workspaceBScope = {...baseScope, workspaceId: 'workspace-b'};
    let resolveA: (value: {token: string; expiresAt: Date}) => void = () => undefined;
    let resolveB: (value: {token: string; expiresAt: Date}) => void = () => undefined;
    const lateA = new Promise<{token: string; expiresAt: Date}>((resolve) => {
      resolveA = resolve;
    });
    const lateB = new Promise<{token: string; expiresAt: Date}>((resolve) => {
      resolveB = resolve;
    });

    await expect(shared.getOrMint(baseScope, () => lateA)).rejects.toMatchObject({
      reason: 'timeout',
    });
    await expect(shared.getOrMint(workspaceBScope, () => lateB)).rejects.toMatchObject({
      reason: 'timeout',
    });
    await expect(shared.deleteInstallation('workspace-a', 'provider-a', 11)).resolves.toBe(0);

    resolveA(token('workspace-a-late'));
    resolveB(token('workspace-b-late'));
    await Promise.resolve();

    await vi.waitFor(async () => {
      await expect(
        shared.getOrMint(workspaceBScope, () => Promise.reject(new Error('must not mint'))),
      ).resolves.toMatchObject({token: 'workspace-b-late'});
    });
  });

  it('cleans expired shared entries in a bounded pass', async () => {
    const store = createStore();
    const expiredKey = githubCheckoutTokenStorageKey(baseScope);
    const newerVersionKey = 'v2-newer';
    const unrelatedKey = 'not-a-checkout-token';
    store.values.set(newerVersionKey, '{"version":2}');
    store.values.set(unrelatedKey, 'not an envelope');
    store.values.set(
      expiredKey,
      encodeGithubCheckoutTokenEnvelope({
        version: GITHUB_CHECKOUT_TOKEN_CACHE_VERSION,
        generation: 'old',
        token: 'old-token',
        expiresAt: new Date('2026-06-09T10:00:00.000Z'),
        repositoryId: 42,
        permissions: {contents: 'read'},
      }),
    );
    const shared = cache({store});

    const deleted = await shared.cleanupExpired(baseScope, 10);

    expect(deleted).toBe(1);
    expect(store.values.has(expiredKey)).toBe(false);
    expect(store.values.has(newerVersionKey)).toBe(true);
    expect(store.values.has(unrelatedKey)).toBe(true);
  });

  it('deletes only one provider installation and purges its RAM entries', async () => {
    const values = new Map<string, string>();
    const deletedNamespaces = new Set<string>();
    const deleteNamespace = vi.fn(({namespace}: {workspaceId: string; namespace: string}) => {
      deletedNamespaces.add(namespace);
      return Promise.resolve(1);
    });
    const store: GithubCheckoutTokenSecretStore = {
      read: ({namespace, key}) =>
        Promise.resolve(deletedNamespaces.has(namespace) ? null : (values.get(key) ?? null)),
      write: ({key, value}) => {
        values.set(key, value);
        return Promise.resolve();
      },
      deleteNamespace,
    };
    const shared = cache({store});
    const mint = vi
      .fn()
      .mockResolvedValueOnce(token('token-a'))
      .mockResolvedValueOnce(token('other-token'))
      .mockResolvedValueOnce(token('reminted-token'));
    const otherScope = {...baseScope, installationId: 12};

    await shared.getOrMint(baseScope, mint);
    await shared.getOrMint(otherScope, mint);
    const deleted = await shared.deleteInstallation('workspace-a', 'provider-a', 11);

    expect(deleted).toBe(1);
    expect(deleteNamespace).toHaveBeenCalledWith({
      workspaceId: 'workspace-a',
      namespace: 'system/github/checkout-token/provider-a/11',
    });
    await expect(shared.getOrMint(baseScope, mint)).resolves.toMatchObject({
      token: 'reminted-token',
    });
    await expect(shared.getOrMint(otherScope, mint)).resolves.toMatchObject({
      token: 'other-token',
    });
    expect(mint).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed scopes before reading or minting', async () => {
    const read = vi.fn(() => Promise.resolve(null));
    const mint = vi.fn(() => Promise.resolve(token('token-a')));
    const shared = cache({
      store: {
        read,
        write: () => Promise.resolve(),
      },
    });
    const malformedScopes: GithubCheckoutTokenScope[] = [
      {...baseScope, workspaceId: ''},
      {...baseScope, providerInstance: ''},
      {...baseScope, installationId: 0},
      {...baseScope, repositoryId: 0},
      {...baseScope, permissions: {}},
    ];

    for (const scope of malformedScopes) {
      await expect(shared.getOrMint(scope, mint)).rejects.toMatchObject({
        reason: 'malformed-provider-response',
      });
    }
    expect(read).not.toHaveBeenCalled();
    expect(mint).not.toHaveBeenCalled();
  });

  it('bounds RAM entries and evicts expired entries', async () => {
    let currentTime = now;
    const shared = cache({maxRamEntries: 1, currentTime: () => currentTime});
    const mint = vi
      .fn()
      .mockResolvedValueOnce(token('token-a'))
      .mockResolvedValueOnce(token('token-b'))
      .mockResolvedValueOnce(token('token-c'))
      .mockResolvedValueOnce(token('token-d', undefined, '2026-06-10T13:00:00.000Z'));

    await shared.getOrMint(baseScope, mint);
    await shared.getOrMint({...baseScope, repositoryId: 43}, mint);
    await shared.getOrMint(baseScope, mint);
    expect(mint).toHaveBeenCalledTimes(3);

    currentTime = new Date('2026-06-10T12:01:00.000Z');
    await shared.getOrMint(baseScope, mint);
    expect(mint).toHaveBeenCalledTimes(4);
    await shared.getOrMint(baseScope, mint);
    expect(mint).toHaveBeenCalledTimes(4);
  });
});
