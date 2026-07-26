import type {LinearInstallation} from '#db/installations.js';
import {createLinearIntegrationProvider} from '#index.js';

function installation(overrides: Partial<LinearInstallation> = {}): LinearInstallation {
  return {
    id: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    organizationId: 'org-1',
    organizationUrlKey: 'acme',
    appUserId: 'app-user-1',
    scopes: ['read', 'write'],
    tokenExpiresAt: null,
    status: 'installed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('linear connectionExternalUrl', () => {
  it('resolves the organization application settings URL from the installation row', async () => {
    const connectionId = crypto.randomUUID();
    const provider = createLinearIntegrationProvider({
      getLinearInstallationByConnectionId: () =>
        Promise.resolve(installation({connectionId, organizationUrlKey: 'acme'})),
    });

    const url = await provider.connectionExternalUrl({id: connectionId});

    expect(url).toBe('https://linear.app/acme/settings/applications/test-client-id');
  });

  it('URL-encodes the organization URL key', async () => {
    const provider = createLinearIntegrationProvider({
      getLinearInstallationByConnectionId: () =>
        Promise.resolve(installation({organizationUrlKey: 'a/b c'})),
    });

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBe('https://linear.app/a%2Fb%20c/settings/applications/test-client-id');
  });

  it('returns undefined when the installation row is missing', async () => {
    const provider = createLinearIntegrationProvider({
      getLinearInstallationByConnectionId: () => Promise.resolve(undefined),
    });

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });

  it('returns undefined when the organization URL key is absent', async () => {
    const provider = createLinearIntegrationProvider({
      getLinearInstallationByConnectionId: () =>
        Promise.resolve(installation({organizationUrlKey: ''})),
    });

    const url = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(url).toBeUndefined();
  });
});
