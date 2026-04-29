import {ClientError} from '@shipfox/node-fastify';
import {upsertIntegrationConnection} from '#db/connections.js';
import {
  createTestApp,
  requireMembershipMock,
  sourceProvider,
  useIntegrationRouteTest,
} from '#test/route-utils.js';

describe('GET /integration-connections', () => {
  const context = useIntegrationRouteTest();

  it('lists only active workspace connections by capability', async () => {
    const app = await createTestApp([sourceProvider()]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'debug',
      externalAccountId: 'debug',
      displayName: 'Debug',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      displayName: 'GitHub',
      capabilities: [],
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'installation-1',
      displayName: 'GitHub',
      lifecycleStatus: 'error',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}&capability=source_control`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res.json().connections.map((connection: {provider: string}) => connection.provider),
    ).toEqual(['debug']);
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    requireMembershipMock.mockRejectedValueOnce(
      new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
