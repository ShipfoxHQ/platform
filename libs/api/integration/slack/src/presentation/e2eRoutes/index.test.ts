import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createSlackE2eRoutes} from './index.js';

function connection(overrides: Partial<IntegrationConnection<'slack'>> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'slack',
    externalAccountId: 'T123',
    slug: 'slack_acme',
    displayName: 'Slack Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  } satisfies IntegrationConnection<'slack'>;
}

describe('Slack E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a connection and stores its bot token without returning it', async () => {
    const tokenStore = {storeTokens: vi.fn(() => Promise.resolve())};
    const app = await createApp({
      routes: [
        createSlackE2eRoutes({
          tokenStore,
          getExistingSlackConnection: vi.fn(() => Promise.resolve(undefined)),
          connectSlackInstallation: vi.fn(() => Promise.resolve(connection())),
          disconnectSlackInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: [],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/slack-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        team_id: 'T123',
        team_name: 'Acme',
        app_id: 'A123',
        bot_user_id: 'U123',
        bot_token: 'xoxb-e2e-token',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({provider: 'slack', capabilities: []});
    expect(res.body).not.toContain('xoxb-e2e-token');
    expect(tokenStore.storeTokens).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      botToken: 'xoxb-e2e-token',
    });
  });

  it('rejects a Slack team connected to another workspace', async () => {
    const connectSlackInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createSlackE2eRoutes({
          tokenStore: {storeTokens: vi.fn(() => Promise.resolve())},
          getExistingSlackConnection: vi.fn(() =>
            Promise.resolve(connection({workspaceId: '00000000-0000-4000-8000-000000000003'})),
          ),
          connectSlackInstallation,
          disconnectSlackInstallation: vi.fn(() => Promise.resolve()),
          connectionCapabilities: [],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/slack-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        team_id: 'T123',
        team_name: 'Acme',
        app_id: 'A123',
        bot_user_id: 'U123',
        bot_token: 'xoxb-e2e-token',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({code: 'slack-connection-workspace-mismatch'});
    expect(connectSlackInstallation).not.toHaveBeenCalled();
  });
});
