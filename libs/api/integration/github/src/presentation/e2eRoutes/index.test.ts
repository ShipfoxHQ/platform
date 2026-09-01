import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {createGithubE2eRoutes} from './index.js';

function connection(
  overrides: Partial<IntegrationConnection<'github'>> = {},
): IntegrationConnection<'github'> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    provider: 'github',
    externalAccountId: '1234',
    slug: 'github_shipfox_e2e',
    displayName: 'GitHub Shipfox E2E',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

describe('GitHub E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('creates a synthetic GitHub connection and installation', async () => {
    const connectGithubInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createGithubE2eRoutes({
          getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
          connectGithubInstallation,
          connectionCapabilities: ['source_control', 'agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/github-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        installation_id: 1234,
        account_login: 'shipfox-e2e',
        display_name: 'GitHub Shipfox E2E',
        installer_user_id: '00000000-0000-4000-8000-000000000004',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      provider: 'github',
      capabilities: ['source_control', 'agent_tools'],
    });
    expect(connectGithubInstallation).toHaveBeenCalledWith({
      workspaceId: '00000000-0000-4000-8000-000000000002',
      installationId: '1234',
      displayName: 'GitHub Shipfox E2E',
      installerUserId: '00000000-0000-4000-8000-000000000004',
      installation: expect.objectContaining({
        installationId: '1234',
        accountLogin: 'shipfox-e2e',
        accountType: 'Organization',
        repositorySelection: 'all',
        installerUserId: '00000000-0000-4000-8000-000000000004',
      }),
    });
  });

  it('rejects malformed connection bodies', async () => {
    const app = await createApp({
      routes: [
        createGithubE2eRoutes({
          getExistingGithubConnection: vi.fn(() => Promise.resolve(undefined)),
          connectGithubInstallation: vi.fn(() => Promise.resolve(connection())),
          connectionCapabilities: ['source_control', 'agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/github-connections',
      payload: {workspace_id: 'not-a-uuid'},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'validation-error'});
  });

  it('rejects an installation connected to another workspace', async () => {
    const connectGithubInstallation = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      routes: [
        createGithubE2eRoutes({
          getExistingGithubConnection: vi.fn(() =>
            Promise.resolve(connection({workspaceId: '00000000-0000-4000-8000-000000000003'})),
          ),
          connectGithubInstallation,
          connectionCapabilities: ['source_control', 'agent_tools'],
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/github-connections',
      payload: {
        workspace_id: '00000000-0000-4000-8000-000000000002',
        installation_id: 1234,
        account_login: 'shipfox-e2e',
        display_name: 'GitHub Shipfox E2E',
        installer_user_id: '00000000-0000-4000-8000-000000000004',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({code: 'github-connection-workspace-mismatch'});
    expect(connectGithubInstallation).not.toHaveBeenCalled();
  });
});
