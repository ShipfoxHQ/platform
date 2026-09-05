import {createHash} from 'node:crypto';
import {secretKeySchema} from '@shipfox/api-secrets-dto';
import {GithubIntegrationProviderError} from '#core/errors.js';
import type {GithubInstallationAccessToken} from './client.js';
import {
  backoffActive,
  encodeInstallationTokenEnvelope,
  GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
  GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY,
  githubInstallationTokenBackoffKey,
  githubInstallationTokenKey,
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

const errorMonitoring = vi.hoisted(() => ({reportError: vi.fn()}));
const loggerMocks = vi.hoisted(() => ({info: vi.fn(), warn: vi.fn()}));
vi.mock('@shipfox/node-error-monitoring', () => errorMonitoring);
vi.mock('@shipfox/node-opentelemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-opentelemetry')>()),
  logger: () => loggerMocks,
}));

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
    read(readWorkspaceId: string, readInstallationId: number, key: string) {
      if (!secretKeySchema.safeParse(key).success) {
        return Promise.reject(new Error(`invalid secret key: ${key}`));
      }
      if (store.failReads) return Promise.reject(new Error('read failed'));
      return Promise.resolve(values.get(`${readWorkspaceId}:${readInstallationId}:${key}`) ?? null);
    },
    write(
      writeWorkspaceId: string,
      writeInstallationId: number,
      key: string,
      envelope: Parameters<InstallationTokenSecretStore['write']>[3],
    ) {
      if (!secretKeySchema.safeParse(key).success) {
        return Promise.reject(new Error(`invalid secret key: ${key}`));
      }
      if (store.failWrites) return Promise.reject(new Error('write failed'));
      values.set(
        `${writeWorkspaceId}:${writeInstallationId}:${key}`,
        encodeInstallationTokenEnvelope(envelope),
      );
      return Promise.resolve();
    },
    readGeneration(readWorkspaceId: string, readInstallationId: number) {
      return Promise.resolve(
        values.get(`${readWorkspaceId}:${readInstallationId}:GENERATION`) ?? null,
      );
    },
    writeGeneration(writeWorkspaceId: string, writeInstallationId: number, generation: string) {
      values.set(`${writeWorkspaceId}:${writeInstallationId}:GENERATION`, generation);
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
          permissionFingerprint: string,
          fn: () => Promise<T>,
        ) => Promise<InstallationTokenLockResult<T>>)
      | undefined;
    withBackoffLock?:
      | (<T>(
          installationId: number,
          permissionFingerprint: string,
          fn: () => Promise<T>,
        ) => Promise<InstallationTokenLockResult<T>>)
      | undefined;
    shareCompatibilityLock?: boolean | undefined;
    resolveWorkspaceId?: ((installationId: number) => Promise<string>) | undefined;
    sleep?: ((ms: number) => Promise<void>) | undefined;
    pollDelaysMs?: number[] | undefined;
  } = {},
) {
  return new SharedInstallationTokenCache({
    secretStore: options.store ?? createStore(),
    withLock:
      options.withLock ??
      (async (_id, _permissionFingerprint, fn) => ({acquired: true, value: await fn()})),
    withBackoffLock:
      options.withBackoffLock ??
      options.withLock ??
      (async (_id, _permissionFingerprint, fn) => ({acquired: true, value: await fn()})),
    shareCompatibilityLock:
      options.shareCompatibilityLock ??
      (options.withBackoffLock === undefined
        ? options.withLock !== undefined
        : options.withBackoffLock === options.withLock),
    resolveWorkspaceId: options.resolveWorkspaceId ?? (() => Promise.resolve(workspaceId)),
    now: () => options.now ?? new Date('2026-06-10T11:00:00.000Z'),
    sleep: options.sleep ?? (() => Promise.resolve()),
    pollDelaysMs: options.pollDelaysMs ?? [],
  });
}

function setEnvelope(
  store: {values: Map<string, string>},
  envelope: Parameters<typeof encodeInstallationTokenEnvelope>[0],
  permissionFingerprint = GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
) {
  store.values.set(
    `${workspaceId}:${installationId}:${githubInstallationTokenKey(permissionFingerprint)}`,
    encodeInstallationTokenEnvelope(envelope),
  );
}

describe('SharedInstallationTokenCache', () => {
  it('does not collide raw and hashed permission fingerprints', () => {
    const rawFingerprint = 'profile-without-safe-key';
    const hashedFingerprint = createHash('sha256')
      .update(rawFingerprint, 'utf8')
      .digest('hex')
      .toUpperCase();

    expect(githubInstallationTokenKey(rawFingerprint)).not.toBe(
      githubInstallationTokenKey(hashedFingerprint),
    );
  });

  it('reads the fixed-key compatibility envelope without invalid secret reads', async () => {
    const store = createStore();
    store.values.set(
      `${workspaceId}:${installationId}:${GITHUB_INSTALLATION_TOKEN_ENVELOPE_KEY}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:05:00.000Z'),
        backoffReason: 'rate-limited',
        backoffError: {message: 'rate limited', status: 429},
      }),
    );
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({reason: 'rate-limited', status: 429});
    expect(mint).not.toHaveBeenCalled();
    expect(errorMonitoring.reportError).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    errorMonitoring.reportError.mockReset();
    loggerMocks.info.mockReset();
    loggerMocks.warn.mockReset();
  });

  it('mints once on a cold winner miss and writes the secret envelope', async () => {
    const store = createStore();
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

    expect(result).toEqual(token('ghs_new'));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('ghs_new');
  });

  it('isolates profile tokens while allowing different profiles to mint independently', async () => {
    const store = createStore();
    const shared = cache({store});
    const broadMint = vi.fn(() => Promise.resolve(token('ghs_broad')));
    const narrowMint = vi.fn(() => Promise.resolve(token('ghs_narrow')));

    await expect(shared.getOrMint(installationId, 'broad', broadMint)).resolves.toEqual(
      token('ghs_broad'),
    );
    await expect(shared.getOrMint(installationId, 'narrow', narrowMint)).resolves.toEqual(
      token('ghs_narrow'),
    );
    await expect(shared.getOrMint(installationId, 'broad', broadMint)).resolves.toEqual(
      token('ghs_broad'),
    );
    await expect(shared.getOrMint(installationId, 'narrow', narrowMint)).resolves.toEqual(
      token('ghs_narrow'),
    );

    expect(broadMint).toHaveBeenCalledTimes(1);
    expect(narrowMint).toHaveBeenCalledTimes(1);
    expect(
      store.values.has(`${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`),
    ).toBe(true);
    expect(
      store.values.has(`${workspaceId}:${installationId}:${githubInstallationTokenKey('narrow')}`),
    ).toBe(true);
  });

  it('isolates profile-specific backoff across permission profile keys', async () => {
    const store = createStore();
    const shared = cache({store});
    const failedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));
    const siblingMint = vi.fn(() => Promise.resolve(token('ghs_sibling')));

    await expect(shared.getOrMint(installationId, 'broad', failedMint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    await expect(shared.getOrMint(installationId, 'narrow', siblingMint)).resolves.toEqual(
      token('ghs_sibling'),
    );

    expect(failedMint).toHaveBeenCalledTimes(1);
    expect(siblingMint).toHaveBeenCalledTimes(1);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toContain('provider-rejected');
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('narrow')}`,
      ),
    ).toBe('{}');
  });

  it('shares installation-wide backoff across permission profile keys', async () => {
    const store = createStore();
    const lockFingerprints: string[] = [];
    const shared = cache({
      store,
      withLock: async <T>(
        _installationId: number,
        permissionFingerprint: string,
        fn: () => Promise<T>,
      ): Promise<InstallationTokenLockResult<T>> => {
        lockFingerprints.push(permissionFingerprint);
        return {acquired: true as const, value: await fn()};
      },
    });
    const failedMint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-unavailable', 'unavailable'));
    const siblingMint = vi.fn(() => Promise.resolve(token('ghs_sibling')));

    await expect(shared.getOrMint(installationId, 'broad', failedMint)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
    await expect(shared.getOrMint(installationId, 'narrow', siblingMint)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });

    expect(failedMint).toHaveBeenCalledTimes(1);
    expect(siblingMint).not.toHaveBeenCalled();
    expect(lockFingerprints).toContain(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('provider-unavailable');
  });

  it('preserves an active terminal backoff over a later transient backoff', async () => {
    const store = createStore();
    setEnvelope(
      store,
      {
        ...token('ghs_existing', '2026-06-10T11:04:30.000Z'),
      },
      'broad',
    );
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:10:00.000Z'),
        backoffReason: 'provider-rejected',
      }),
    );
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      encodeInstallationTokenEnvelope({
        backoffUntil: new Date('2026-06-10T11:15:00.000Z'),
        backoffReason: 'provider-unavailable',
      }),
    );
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    await expect(shared.getOrMint(installationId, 'broad', mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(mint).not.toHaveBeenCalled();
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
    const withLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) => {
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
    const withBackoffLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) => ({acquired: true as const, value: await fn()});
    const firstReplica = cache({store, withLock, withBackoffLock});
    const secondReplica = cache({
      store,
      withLock,
      withBackoffLock,
      sleep: () => lockReleased,
      pollDelaysMs: [1],
    });

    const first = firstReplica.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    await mintStarted;
    const second = secondReplica.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    const results = await Promise.all([first, second]);

    expect(results).toEqual([token('ghs_shared'), token('ghs_shared')]);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('writes a minted token before releasing its profile lock', async () => {
    const store = createStore();
    const profileKey = githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    let lockHeld = false;
    let lockReleased = false;
    let lockWasHeldDuringWrite: boolean | undefined;
    let releaseWrite: () => void = () => undefined;
    let resolveWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      resolveWriteStarted = resolve;
    });
    let resolveWriteFinished: () => void = () => undefined;
    const writeFinished = new Promise<void>((resolve) => {
      resolveWriteFinished = resolve;
    });
    const originalWrite = store.write;
    store.write = async (writeWorkspaceId, writeInstallationId, key, envelope) => {
      if (key === profileKey) {
        resolveWriteStarted();
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
        lockWasHeldDuringWrite = !lockReleased;
      }
      await originalWrite(writeWorkspaceId, writeInstallationId, key, envelope);
      if (key === profileKey) resolveWriteFinished();
    };
    const withLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) => {
      if (lockHeld) return {acquired: false as const};
      lockHeld = true;
      try {
        return {acquired: true as const, value: await fn()};
      } finally {
        lockHeld = false;
        lockReleased = true;
      }
    };
    const shared = cache({
      store,
      withLock,
      withBackoffLock: withLock,
      sleep: () => writeFinished,
      pollDelaysMs: [1],
    });
    const mint = vi.fn(() => Promise.resolve(token('ghs_shared')));

    const first = shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    await writeStarted;
    const second = shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );
    releaseWrite();

    await expect(Promise.all([first, second])).resolves.toEqual([
      token('ghs_shared'),
      token('ghs_shared'),
    ]);
    expect(mint).toHaveBeenCalledOnce();
    expect(lockWasHeldDuringWrite).toBe(true);
  });

  it('waits for in-flight writes before installation namespace deletion', async () => {
    const store = createStore();
    const backoffKey = githubInstallationTokenBackoffKey('broad');
    let releaseWrite: () => void = () => undefined;
    let resolveWriteStarted: () => void = () => undefined;
    const writeStarted = new Promise<void>((resolve) => {
      resolveWriteStarted = resolve;
    });
    const originalWrite = store.write;
    store.write = async (writeWorkspaceId, writeInstallationId, key, envelope) => {
      if (key === backoffKey) {
        resolveWriteStarted();
        await new Promise<void>((resolve) => {
          releaseWrite = resolve;
        });
      }
      await originalWrite(writeWorkspaceId, writeInstallationId, key, envelope);
    };
    let lockHeld = false;
    let lockReleased = Promise.resolve();
    const withBackoffLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ) => {
      if (lockHeld) await lockReleased;
      lockHeld = true;
      let resolveRelease!: () => void;
      lockReleased = new Promise<void>((resolve) => {
        resolveRelease = resolve;
      });
      try {
        return {acquired: true as const, value: await fn()};
      } finally {
        lockHeld = false;
        resolveRelease();
      }
    };
    const shared = cache({store, withBackoffLock});
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    const failedMint = shared.getOrMint(installationId, 'broad', mint);
    await writeStarted;

    let deleted = false;
    const deletion = shared
      .deleteInstallation(installationId, {
        deleteNamespace: () => {
          store.values.clear();
          return Promise.resolve(1);
        },
      })
      .then(() => {
        deleted = true;
      });
    await Promise.resolve();
    expect(deleted).toBe(false);

    releaseWrite();
    await deletion;
    await expect(failedMint).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(store.values.get(`${workspaceId}:${installationId}:GENERATION`)).toEqual(
      expect.any(String),
    );
    expect(store.values.has(`${workspaceId}:${installationId}:${backoffKey}`)).toBe(false);
  });

  it('skips token and backoff writes from a mint crossing invalidation', async () => {
    const store = createStore();
    const shared = cache({store});
    let resolveMint: (value: GithubInstallationAccessToken) => void = () => undefined;
    let resolveMintStarted: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      resolveMintStarted = resolve;
    });
    const pendingMint = shared.getOrMint(installationId, 'broad', () => {
      resolveMintStarted();
      return new Promise<GithubInstallationAccessToken>((resolve) => {
        resolveMint = resolve;
      });
    });
    await mintStarted;
    await shared.deleteInstallation(installationId);
    resolveMint(token('late-token'));
    await expect(pendingMint).resolves.toEqual(token('late-token'));
    expect(
      store.values.has(`${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`),
    ).toBe(false);

    const refreshed = await shared.getOrMint(installationId, 'broad', () =>
      Promise.resolve(token('fresh-token')),
    );
    expect(refreshed).toEqual(token('fresh-token'));
  });

  it('skips a backoff write from a failed mint crossing invalidation', async () => {
    const store = createStore();
    const shared = cache({store});
    let rejectMint: (error: Error) => void = () => undefined;
    let resolveMintStarted: () => void = () => undefined;
    const mintStarted = new Promise<void>((resolve) => {
      resolveMintStarted = resolve;
    });
    const pendingMint = shared.getOrMint(installationId, 'broad', () => {
      resolveMintStarted();
      return new Promise<GithubInstallationAccessToken>((_resolve, reject) => {
        rejectMint = reject;
      });
    });
    await mintStarted;
    await shared.deleteInstallation(installationId);
    rejectMint(new GithubIntegrationProviderError('provider-rejected', 'rejected'));
    await expect(pendingMint).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(
      store.values.has(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toBe(false);
  });

  it('rejects installation invalidation when the distributed lock is unavailable', async () => {
    const shared = cache({
      withBackoffLock: () => Promise.resolve({acquired: false}),
    });

    await expect(shared.deleteInstallation(installationId)).rejects.toMatchObject({
      reason: 'provider-unavailable',
    });
  });

  it('does not serve an envelope from an older generation', async () => {
    const store = createStore();
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenKey('broad')}`,
      encodeInstallationTokenEnvelope({
        generation: 'old-generation',
        ...token('ghs_old'),
      }),
    );
    store.values.set(`${workspaceId}:${installationId}:GENERATION`, 'new-generation');
    const shared = cache({store});
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));

    await expect(shared.getOrMint(installationId, 'broad', mint)).resolves.toEqual(
      token('ghs_new'),
    );
    expect(mint).toHaveBeenCalledOnce();
  });

  it('serves a warm store hit with a matching generation', async () => {
    const store = createStore();
    const generation = 'gen-1';
    store.values.set(`${workspaceId}:${installationId}:GENERATION`, generation);
    setEnvelope(store, {
      generation,
      ...token('ghs_stamped'),
    });
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).resolves.toEqual(token('ghs_stamped'));
    expect(mint).not.toHaveBeenCalled();
  });

  it('returns a warm store hit without minting', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_cached'));
    const mint = vi.fn(() => Promise.resolve(token('ghs_new')));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

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

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

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

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      mint,
    );

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

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).not.toContain('backoff');
  });

  it('records transient backoff and short-circuits the next call with the stored reason', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('rate-limited', 'rate limited', 42));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'rate-limited',
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'rate-limited',
      retryAfterSeconds: 42,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('persists compatibility-profile backoff without nested lock polling', async () => {
    const store = createStore();
    const lockCalls: string[] = [];
    let lockHeld = false;
    const withLock = async <T>(
      _id: number,
      permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => {
      lockCalls.push(permissionFingerprint);
      if (lockHeld) return {acquired: false};
      lockHeld = true;
      try {
        return {acquired: true, value: await fn()};
      } finally {
        lockHeld = false;
      }
    };
    const sleep = vi.fn(() => Promise.resolve());
    const shared = cache({
      store,
      withLock,
      sleep,
      pollDelaysMs: [100, 200],
    });
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({reason: 'provider-rejected'});

    expect(lockCalls).toEqual([
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
    ]);
    expect(sleep).not.toHaveBeenCalled();
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('provider-rejected');
  });

  it('keeps the backoff result when profile preservation fails', async () => {
    const store = createStore();
    const profileKey = githubInstallationTokenKey('broad');
    const originalWrite = store.write;
    store.write = async (writeWorkspaceId, writeInstallationId, key, envelope) => {
      if (key === profileKey) return Promise.reject(new Error('profile write failed'));
      return await originalWrite(writeWorkspaceId, writeInstallationId, key, envelope);
    };
    const shared = cache({store});
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(shared.getOrMint(installationId, 'broad', mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toContain('provider-rejected');
    expect(errorMonitoring.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({operation: 'write-profile-envelope'}),
    );
  });

  it('records terminal backoff without hiding access denied as provider unavailable', async () => {
    const store = createStore();
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('access-denied', 'denied'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'access-denied',
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
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

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });
    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({
      reason: 'provider-rejected',
      message: 'commit_id is missing',
      status: 422,
    });

    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('persists profile backoff after profile lock contention', async () => {
    const store = createStore();
    let profileLockAttempts = 0;
    const withLock = async <T>(
      _id: number,
      permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => {
      if (permissionFingerprint === 'broad' && profileLockAttempts++ > 0) {
        return {acquired: false};
      }
      return {acquired: true, value: await fn()};
    };
    const withBackoffLock = async <T>(
      _id: number,
      _permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => ({
      acquired: true,
      value: await fn(),
    });
    const shared = cache({store, withLock, withBackoffLock});
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(shared.getOrMint(installationId, 'broad', mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });

    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toContain('provider-rejected');
    expect(profileLockAttempts).toBe(2);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({backoffPersisted: true}),
      expect.any(String),
    );
  });

  it('does not claim a profile backoff was persisted when both locks contend', async () => {
    const store = createStore();
    let profileLockAttempts = 0;
    const withLock = async <T>(
      _id: number,
      permissionFingerprint: string,
      fn: () => Promise<T>,
    ): Promise<InstallationTokenLockResult<T>> => {
      if (permissionFingerprint === 'broad' && profileLockAttempts++ > 0) {
        return {acquired: false};
      }
      return {acquired: true, value: await fn()};
    };
    const shared = cache({
      store,
      withLock,
      withBackoffLock: () => Promise.resolve({acquired: false}),
    });
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(shared.getOrMint(installationId, 'broad', mint)).rejects.toMatchObject({
      reason: 'provider-rejected',
    });
    expect(
      store.values.has(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey('broad')}`,
      ),
    ).toBe(false);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({backoffPersisted: false}),
      expect.any(String),
    );
  });

  it('serves stale when refresh minting fails while the token is still valid', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.reject(new GithubIntegrationProviderError('provider-unavailable', 'down')),
    );

    expect(result).toEqual(token('ghs_existing', '2026-06-10T11:04:30.000Z'));
  });

  it('does not serve stale when refresh minting fails with a terminal reason', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_existing', '2026-06-10T11:04:30.000Z'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
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
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).rejects.toMatchObject({reason: 'installation-not-found'});
  });

  it('returns a minted token when the generation read fails', async () => {
    const store = createStore();
    setEnvelope(store, token('ghs_cached'));
    store.readGeneration = () => Promise.reject(new Error('generation read failed'));
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).resolves.toEqual(token('ghs_new'));
    expect(errorMonitoring.reportError).toHaveBeenCalledOnce();
  });

  it('does not persist backoff while the generation marker is unavailable', async () => {
    const store = createStore();
    const profileKey = githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT);
    const existingEnvelope = encodeInstallationTokenEnvelope({
      generation: 'gen-1',
      ...token('ghs_stamped'),
    });
    store.values.set(`${workspaceId}:${installationId}:GENERATION`, 'gen-1');
    store.values.set(`${workspaceId}:${installationId}:${profileKey}`, existingEnvelope);
    store.readGeneration = () => Promise.reject(new Error('generation read failed'));
    const shared = cache({store});
    const mint = vi
      .fn()
      .mockRejectedValue(new GithubIntegrationProviderError('provider-rejected', 'rejected'));

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, mint),
    ).rejects.toMatchObject({reason: 'provider-rejected'});
    expect(
      store.values.has(
        `${workspaceId}:${installationId}:${githubInstallationTokenBackoffKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toBe(false);
    expect(store.values.get(`${workspaceId}:${installationId}:${profileKey}`)).toBe(
      existingEnvelope,
    );
  });

  it('treats a generation read failure during a cache write as a skipped write', async () => {
    const store = createStore();
    const originalReadGeneration = store.readGeneration;
    let generationReads = 0;
    store.readGeneration = (readWorkspaceId, readInstallationId) => {
      generationReads += 1;
      if (generationReads === 2) return Promise.reject(new Error('generation read failed'));
      return originalReadGeneration(readWorkspaceId, readInstallationId);
    };
    const shared = cache({store});

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).resolves.toEqual(token('ghs_new'));

    expect(errorMonitoring.reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({operation: 'read-envelope'}),
    );
    expect(errorMonitoring.reportError).not.toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({operation: 'write-minted-token'}),
    );
    expect(
      store.values.has(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toBe(false);
  });

  it('uses the supplied workspace for installation invalidation', async () => {
    const store = createStore();
    const resolveWorkspaceId = vi.fn(() =>
      Promise.reject(new GithubIntegrationProviderError('installation-not-found', 'missing')),
    );
    const shared = cache({store, resolveWorkspaceId});
    const deleteNamespace = vi.fn(() => {
      store.values.clear();
      return Promise.resolve(1);
    });

    await expect(
      shared.deleteInstallation(installationId, {workspaceId, deleteNamespace}),
    ).resolves.toBe(1);

    expect(resolveWorkspaceId).not.toHaveBeenCalled();
    expect(store.values.get(`${workspaceId}:${installationId}:GENERATION`)).toEqual(
      expect.any(String),
    );
    expect(deleteNamespace).toHaveBeenCalledOnce();
  });

  it('returns a minted token when the cache read fails', async () => {
    const store = createStore();
    store.failReads = true;
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
  });

  it('reports one read failure across a contended poll', async () => {
    const store = createStore();
    store.failReads = true;
    const shared = cache({
      store,
      withLock: () => Promise.resolve({acquired: false}),
      pollDelaysMs: [1],
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).rejects.toMatchObject({reason: 'provider-unavailable'});

    expect(errorMonitoring.reportError).toHaveBeenCalledTimes(1);
  });

  it('returns a minted token when the cache write fails', async () => {
    const store = createStore();
    store.failWrites = true;
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
  });

  it('returns a minted token when the cache write lock is contended', async () => {
    const store = createStore();
    const shared = cache({
      store,
      withBackoffLock: () => Promise.resolve({acquired: false}),
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
    ).resolves.toEqual(token('ghs_new'));
    expect(errorMonitoring.reportError).not.toHaveBeenCalled();
    expect(
      store.values.has(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toBe(false);
  });

  it('treats an invalid envelope as a miss and overwrites it', async () => {
    const store = createStore();
    store.values.set(
      `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      '{bad json',
    );
    const shared = cache({store});

    const result = await shared.getOrMint(
      installationId,
      GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT,
      () => Promise.resolve(token('ghs_new')),
    );

    expect(result).toEqual(token('ghs_new'));
    expect(
      store.values.get(
        `${workspaceId}:${installationId}:${githubInstallationTokenKey(GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT)}`,
      ),
    ).toContain('ghs_new');
  });

  it('surfaces an unresolvable installation as installation-not-found', async () => {
    const shared = cache({
      resolveWorkspaceId: () =>
        Promise.reject(new GithubIntegrationProviderError('installation-not-found', 'missing')),
    });

    await expect(
      shared.getOrMint(installationId, GITHUB_COMPATIBILITY_PERMISSION_FINGERPRINT, () =>
        Promise.resolve(token('ghs_new')),
      ),
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
