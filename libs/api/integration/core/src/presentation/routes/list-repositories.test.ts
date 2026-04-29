import {IntegrationProviderError} from '#core/errors.js';
import {upsertIntegrationConnection} from '#db/connections.js';
import {
  createTestApp,
  requireMembershipMock,
  sourceProvider,
  useIntegrationRouteTest,
} from '#test/route-utils.js';

describe('GET /integration-connections/:connectionId/repositories', () => {
  const context = useIntegrationRouteTest();

  it('loads a connection before authorizing repository listing', async () => {
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections/${connection.id}/repositories`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(requireMembershipMock).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: connection.workspaceId}),
    );
    expect(res.json().repositories[0].full_name).toBe('debug-owner/platform');
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
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
      lifecycleStatus: 'disabled',
      capabilities: ['source_control'],
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
    const app = await createTestApp([sourceProvider()]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      displayName: 'GitHub',
      capabilities: [],
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
      displayName: 'GitHub',
      capabilities: ['source_control'],
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
        sourceControl: {
          listRepositories: async () => {
            await Promise.resolve();
            throw new IntegrationProviderError('rate-limited', 'Provider rate limited', 60);
          },
          resolveRepository: async () => {
            await Promise.resolve();
            throw new Error('not used');
          },
        },
      }),
    ]);
    const connection = await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
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
