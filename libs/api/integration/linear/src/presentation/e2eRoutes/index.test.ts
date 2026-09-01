import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createLinearE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'linear'>> = {},
): IntegrationConnection<'linear'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'linear',
    externalAccountId: 'linear-org',
    slug: 'linear_acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

describe('Linear E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a connection and stores its token without returning it', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const app = await createApp({
      routes: [
        createLinearE2eRoutes({
          tokenStore,
          getExistingLinearConnection: vi.fn(() => Promise.resolve(undefined)),
          connectLinearInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectLinearInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        organization_id: 'linear-org',
        organization_url_key: 'acme',
        app_user_id: 'linear-app-user',
        display_name: 'Linear Acme',
        access_token: 'linear-e2e-token',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      provider: 'linear',
      capabilities: ['agent_tools'],
    });
    expect(res.body).not.toContain('linear-e2e-token');
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      accessToken: 'linear-e2e-token',
    });
  });

  it('rejects malformed connection bodies', async () => {
    const app = await createApp({
      routes: [
        createLinearE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingLinearConnection: vi.fn(() => Promise.resolve(undefined)),
          connectLinearInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectLinearInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear-connections',
      payload: {workspace_id: 'not-a-uuid'},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'validation-error'});
  });

  it('preserves the token storage error when cleanup of a new connection fails', async () => {
    const disconnectLinearInstallation = vi.fn(() => Promise.reject(new Error('cleanup failed')));
    const app = await createApp({
      routes: [
        createLinearE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.reject(new Error('token storage failed')))},
          getExistingLinearConnection: vi.fn(() => Promise.resolve(undefined)),
          connectLinearInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectLinearInstallation,
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        organization_id: 'linear-org',
        organization_url_key: 'acme',
        app_user_id: 'linear-app-user',
        display_name: 'Linear Acme',
        access_token: 'linear-e2e-token',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(disconnectLinearInstallation).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('leaves an existing connection unchanged when token storage fails', async () => {
    const connectLinearInstallation = vi.fn(() => Promise.resolve(connection()));
    const disconnectLinearInstallation = vi.fn(() => Promise.resolve());
    const app = await createApp({
      routes: [
        createLinearE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.reject(new Error('token storage failed')))},
          getExistingLinearConnection: vi.fn(() => Promise.resolve(connection())),
          connectLinearInstallation,
          disconnectLinearInstallation,
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        organization_id: 'linear-org',
        organization_url_key: 'changed-acme',
        app_user_id: 'changed-linear-app-user',
        display_name: 'Changed Linear Acme',
        access_token: 'linear-e2e-token',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(connectLinearInstallation).not.toHaveBeenCalled();
    expect(disconnectLinearInstallation).not.toHaveBeenCalled();
  });

  it('rejects a Linear organization already connected to another workspace', async () => {
    const existing = connection({workspaceId: '00000000-0000-4000-8000-000000000003'});
    const connectLinearInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createLinearE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingLinearConnection: vi.fn(() => Promise.resolve(existing)),
          connectLinearInstallation,
          disconnectLinearInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: ['agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/linear-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        organization_id: 'linear-org',
        organization_url_key: 'acme',
        app_user_id: 'linear-app-user',
        display_name: 'Linear Acme',
        access_token: 'linear-e2e-token',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({code: 'linear-connection-workspace-mismatch'});
    expect(connectLinearInstallation).not.toHaveBeenCalled();
  });
});
