import {sentryEventCatalog} from '@shipfox/api-integration-sentry-dto';
import type {SentryApiClient} from '#api/client.js';
import type {SentryInstallation} from '#db/installations.js';
import {createSentryIntegrationProvider} from '#index.js';

function sentryClient(): SentryApiClient {
  return {
    exchangeAuthorizationCode: vi.fn(() =>
      Promise.resolve({token: 'tok', refreshToken: 'refresh', expiresAt: 'x'}),
    ),
    getInstallation: vi.fn(() => Promise.resolve({orgSlug: 'acme'})),
    verifyInstallation: vi.fn(() => Promise.resolve()),
  };
}

function installation(overrides: Partial<SentryInstallation> = {}): SentryInstallation {
  return {
    id: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    installationUuid: 'install-1',
    orgSlug: 'acme',
    status: 'installed',
    codeHash: null,
    installerUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createProvider(lookup: (connectionId: string) => Promise<SentryInstallation | undefined>) {
  return createSentryIntegrationProvider({
    sentry: sentryClient(),
    getSentryInstallation: vi.fn(() => Promise.resolve(undefined)),
    getConnectionById: vi.fn(() => Promise.resolve(undefined)),
    connectSentryInstallation: vi.fn() as never,
    persistVerifiedUnclaimedInstallation: vi.fn() as never,
    coreDb: vi.fn() as never,
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: false})),
    recordDeliveryOnly: vi.fn(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn(() => Promise.resolve(undefined)),
    updateConnectionLifecycleStatus: vi.fn(() => Promise.resolve(undefined)),
    getSentryInstallationByConnectionId: lookup,
  });
}

describe('sentry connectionExternalUrl', () => {
  it('exposes the Sentry event catalog', () => {
    const provider = createProvider(() => Promise.resolve(undefined));

    expect(provider.eventCatalog).toBe(sentryEventCatalog);
  });

  it('resolves the org URL from the installation row', async () => {
    const connectionId = crypto.randomUUID();
    const provider = createProvider(() => Promise.resolve(installation({orgSlug: 'acme-corp'})));

    const url = await provider.connectionExternalUrl({id: connectionId});

    expect(url).toBe('https://sentry.io/organizations/acme-corp/');
  });

  it('URL-encodes the org slug', async () => {
    const provider = createProvider(() => Promise.resolve(installation({orgSlug: 'a/b c'})));

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBe('https://sentry.io/organizations/a%2Fb%20c/');
  });

  it('returns undefined when the installation row is missing', async () => {
    const provider = createProvider(() => Promise.resolve(undefined));

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });

  it('returns undefined when the org slug is absent', async () => {
    const provider = createProvider(() => Promise.resolve(installation({orgSlug: ''})));

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });
});
