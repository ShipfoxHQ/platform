import {IntegrationProviderError} from '#core/errors.js';
import {upsertIntegrationConnection} from '#db/connections.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('GET /integration-connections/:connectionId/repositories', () => {
  const context = useIntegrationRouteTest();

  it('loads a connection before authorizing repository listing', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().repositories[0].full_name).toBe('gitea-owner/platform');
  });

  it('returns 404 when connection is missing', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${crypto.randomUUID()}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('integration-connection-not-found');
  });

  it('rejects inactive connections', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
      lifecycleStatus: 'disabled',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-connection-inactive');
  });

  it('rejects connections without source-control capability', async () => {
    const app = await createTestApp([
      sourceProvider({
        provider: 'github',
        displayName: 'GitHub',
        adapters: {},
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-capability-unavailable');
  });

  it('returns a stable error when the connection provider is not registered', async () => {
    const app = await createTestApp([]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      slug: 'github_installation_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-provider-unavailable');
  });

  it('maps provider repository listing errors', async () => {
    const app = await createTestApp([
      sourceProvider({
        adapters: {
          source_control: {
            listRepositories: async () => {
              await Promise.resolve();
              throw new IntegrationProviderError('rate-limited', 'Provider rate limited', 60);
            },
            resolveRepository: async () => {
              await Promise.resolve();
              throw new Error('not used');
            },
            listFiles: async () => {
              await Promise.resolve();
              return {files: [], nextCursor: null};
            },
            fetchFile: async () => {
              await Promise.resolve();
              throw new Error('not used');
            },
            resolveTriggerReference: () => null,
          },
        },
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate-limited');
  });
});
