import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {SentryApiClient} from '#api/client.js';
import {
  SentryClaimProofMismatchError,
  SentryInstallationAlreadyLinkedError,
  SentryInstallationDeletedError,
  SentryIntegrationProviderError,
  SentryVerificationInProgressError,
} from '#core/errors.js';
import type {SentryInstallation} from '#db/installations.js';
import {
  type ConnectSentryInstallationInput,
  handleSentryConnect,
  hashAuthorizationCode,
} from './install.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const INSTALL_UUID = 'install-uuid-1';
const CODE = 'the-code';
const CODE_HASH = hashAuthorizationCode(CODE);
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

function sentryClient(overrides: Partial<SentryApiClient> = {}): SentryApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    ),
    getInstallation: vi.fn(() => Promise.resolve({orgSlug: 'acme'})),
    verifyInstallation: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function connection(
  overrides: Partial<IntegrationConnection<'sentry'>> = {},
): IntegrationConnection<'sentry'> {
  return {
    id: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    provider: 'sentry',
    externalAccountId: INSTALL_UUID,
    slug: 'sentry_acme',
    displayName: 'Sentry acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function installation(overrides: Partial<SentryInstallation> = {}): SentryInstallation {
  return {
    id: 'row-1',
    connectionId: null,
    installationUuid: INSTALL_UUID,
    orgSlug: 'acme',
    status: 'installed',
    codeHash: CODE_HASH,
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface RunOptions {
  sentry?: SentryApiClient;
  verifyInstall?: boolean;
  code?: string;
  install?: SentryInstallation | undefined;
  installSequence?: (SentryInstallation | undefined)[];
  connection?: IntegrationConnection<'sentry'> | undefined;
}

function run(options: RunOptions = {}) {
  const sentry = options.sentry ?? sentryClient();
  const sequence = options.installSequence ?? [options.install];
  let call = 0;
  const getSentryInstallation = vi.fn(() => {
    const value = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return Promise.resolve(value);
  });
  const getConnectionById = vi.fn(() => Promise.resolve(options.connection));
  const connectSentryInstallation = vi.fn((input: ConnectSentryInstallationInput) =>
    Promise.resolve(
      connection({
        workspaceId: input.workspaceId,
        externalAccountId: input.installationUuid,
        slug: 'sentry_acme',
        displayName: input.displayName,
      }),
    ),
  );
  const persistVerifiedUnclaimedInstallation = vi.fn(
    (input: {installationUuid: string; orgSlug: string; codeHash: string}) =>
      Promise.resolve(installation({connectionId: null, ...input})),
  );

  const result = handleSentryConnect({
    sentry,
    workspaceId: WORKSPACE_ID,
    code: options.code ?? CODE,
    installationUuid: INSTALL_UUID,
    installerUserId: 'user-1',
    verifyInstall: options.verifyInstall ?? true,
    getSentryInstallation,
    getConnectionById,
    connectSentryInstallation,
    persistVerifiedUnclaimedInstallation,
  });

  return {
    sentry,
    getSentryInstallation,
    getConnectionById,
    connectSentryInstallation,
    persistVerifiedUnclaimedInstallation,
    result,
  };
}

describe('handleSentryConnect: browser-first (no row)', () => {
  it('exchanges, persists the unclaimed row, then binds and verifies last', async () => {
    const sentry = sentryClient();
    const {connectSentryInstallation, persistVerifiedUnclaimedInstallation, result} = run({sentry});

    const connected = await result;

    expect(sentry.exchangeAuthorizationCode).toHaveBeenCalledWith({
      installationUuid: INSTALL_UUID,
      code: CODE,
    });
    expect(persistVerifiedUnclaimedInstallation).toHaveBeenCalledWith({
      installationUuid: INSTALL_UUID,
      orgSlug: 'acme',
      codeHash: CODE_HASH,
    });
    expect(connectSentryInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        installationUuid: INSTALL_UUID,
        orgSlug: 'acme',
        codeHash: CODE_HASH,
        installerUserId: 'user-1',
      }),
    );
    expect(connected.provider).toBe('sentry');

    const persistOrder = persistVerifiedUnclaimedInstallation.mock.invocationCallOrder[0];
    const verifyOrder = vi.mocked(sentry.verifyInstallation).mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(verifyOrder ?? 0);
  });

  it('binds even when the best-effort verify fails (non-fatal)', async () => {
    const sentry = sentryClient({
      verifyInstallation: vi.fn(() => Promise.reject(new Error('verify failed'))),
    });
    const {connectSentryInstallation, result} = run({sentry});

    const connected = await result;

    expect(connectSentryInstallation).toHaveBeenCalled();
    expect(connected.lifecycleStatus).toBe('active');
  });

  it('persists nothing when the code exchange fails outright', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('timeout', 'slow')),
      ),
    });
    const {connectSentryInstallation, persistVerifiedUnclaimedInstallation, result} = run({sentry});

    await expect(result).rejects.toBeInstanceOf(SentryIntegrationProviderError);
    expect(persistVerifiedUnclaimedInstallation).not.toHaveBeenCalled();
    expect(connectSentryInstallation).not.toHaveBeenCalled();
  });
});

describe('handleSentryConnect: verified, unclaimed row exists (webhook-first)', () => {
  it('binds via same-code race when the exchange is already used and the hash matches', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
      ),
    });
    const {connectSentryInstallation, persistVerifiedUnclaimedInstallation, result} = run({
      sentry,
      install: installation({connectionId: null, codeHash: CODE_HASH}),
    });

    const connected = await result;

    expect(persistVerifiedUnclaimedInstallation).not.toHaveBeenCalled();
    expect(connectSentryInstallation).toHaveBeenCalledWith(
      expect.objectContaining({installationUuid: INSTALL_UUID, codeHash: CODE_HASH}),
    );
    expect(connected.provider).toBe('sentry');
  });

  it('binds via a fresh successful exchange (re-entry with a new code), updating the hash', async () => {
    const freshCode = 'fresh-code';
    const sentry = sentryClient();
    const {connectSentryInstallation, result} = run({
      sentry,
      code: freshCode,
      install: installation({connectionId: null, codeHash: hashAuthorizationCode('old-code')}),
    });

    await result;

    expect(sentry.exchangeAuthorizationCode).toHaveBeenCalledWith({
      installationUuid: INSTALL_UUID,
      code: freshCode,
    });
    expect(connectSentryInstallation).toHaveBeenCalledWith(
      expect.objectContaining({codeHash: hashAuthorizationCode(freshCode)}),
    );
  });

  it('rejects with proof mismatch (IDOR) when the code is already used and the hash differs', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
      ),
    });
    const {connectSentryInstallation, result} = run({
      sentry,
      code: 'forged-code',
      install: installation({connectionId: null, codeHash: CODE_HASH}),
    });

    await expect(result).rejects.toBeInstanceOf(SentryClaimProofMismatchError);
    expect(connectSentryInstallation).not.toHaveBeenCalled();
  });
});

describe('handleSentryConnect: already claimed / tombstoned', () => {
  it('is idempotent for an install already claimed to the same workspace', async () => {
    const existing = connection({workspaceId: WORKSPACE_ID});
    const {sentry, connectSentryInstallation, result} = run({
      install: installation({connectionId: CONNECTION_ID}),
      connection: existing,
    });

    const connected = await result;

    expect(connected).toBe(existing);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(connectSentryInstallation).not.toHaveBeenCalled();
  });

  it('throws when the install is claimed to a different workspace', async () => {
    const {sentry, result} = run({
      install: installation({connectionId: CONNECTION_ID}),
      connection: connection({workspaceId: OTHER_WORKSPACE_ID}),
    });

    await expect(result).rejects.toBeInstanceOf(SentryInstallationAlreadyLinkedError);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('throws when the install is tombstoned', async () => {
    const {sentry, result} = run({
      install: installation({status: 'deleted'}),
    });

    await expect(result).rejects.toBeInstanceOf(SentryInstallationDeletedError);
    expect(sentry.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});

describe('handleSentryConnect: simultaneous race', () => {
  it('returns a retryable error when the code is already used and no row is visible yet', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
      ),
    });
    const {result} = run({sentry, installSequence: [undefined, undefined]});

    await expect(result).rejects.toBeInstanceOf(SentryVerificationInProgressError);
  });

  it('reconciles when the concurrent webhook persisted the row between lookups', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi
        .fn()
        // First (browser) exchange loses the race; on re-read we find the row and
        // the second exchange is "already used" with a matching hash → bind.
        .mockRejectedValueOnce(new SentryIntegrationProviderError('access-denied', 'already used'))
        .mockRejectedValueOnce(new SentryIntegrationProviderError('access-denied', 'already used')),
    });
    const {connectSentryInstallation, result} = run({
      sentry,
      installSequence: [undefined, installation({connectionId: null, codeHash: CODE_HASH})],
    });

    const connected = await result;

    expect(connected.provider).toBe('sentry');
    expect(connectSentryInstallation).toHaveBeenCalledWith(
      expect.objectContaining({codeHash: CODE_HASH}),
    );
  });

  it('resolves idempotently when the concurrent webhook claimed the row between lookups', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
      ),
    });
    const existing = connection({workspaceId: WORKSPACE_ID});
    const {connectSentryInstallation, result} = run({
      sentry,
      // First lookup sees no row; the re-read finds it already claimed.
      installSequence: [undefined, installation({connectionId: CONNECTION_ID})],
      connection: existing,
    });

    const connected = await result;

    expect(connected).toBe(existing);
    expect(connectSentryInstallation).not.toHaveBeenCalled();
  });

  it('surfaces a terminal deleted error when the row is tombstoned between lookups', async () => {
    const sentry = sentryClient({
      exchangeAuthorizationCode: vi.fn(() =>
        Promise.reject(new SentryIntegrationProviderError('access-denied', 'already used')),
      ),
    });
    const {result} = run({
      sentry,
      // First lookup sees no row; the re-read finds it tombstoned.
      installSequence: [undefined, installation({status: 'deleted'})],
    });

    await expect(result).rejects.toBeInstanceOf(SentryInstallationDeletedError);
  });
});
