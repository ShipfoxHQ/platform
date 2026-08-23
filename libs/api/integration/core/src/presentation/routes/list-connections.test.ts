import {upsertIntegrationConnection} from '#db/connections.js';
import {linearProviderModule} from '#providers/linear.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('GET /integration-connections', () => {
  const context = useIntegrationRouteTest();

  it('lists workspace connections across all lifecycle statuses', async () => {
    const app = await createTestApp([sourceProvider()]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-active',
      slug: 'debug_active',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'debug-error',
      slug: 'debug_error',
      displayName: 'Gitea',
      capabilities: ['source_control'],
      lifecycleStatus: 'error',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res
        .json()
        .connections.map((connection: {lifecycle_status: string}) => connection.lifecycle_status),
    ).toEqual(['active', 'error']);
  });

  it('drops connections whose provider misses the capability filter', async () => {
    const app = await createTestApp([
      sourceProvider(),
      {provider: 'github', displayName: 'GitHub', adapters: {}},
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}&capability=source_control`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(
      res.json().connections.map((connection: {provider: string}) => connection.provider),
    ).toEqual(['gitea']);
  });

  it('advertises agent tools capability on matching connections', async () => {
    const app = await createTestApp([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: {
            catalog: () => [],
            selectionCatalog: () => ({selectors: []}),
            openSession: async () => {
              await Promise.resolve();
              return {
                call: async () => {
                  await Promise.resolve();
                  return {};
                },
              };
            },
          },
        },
      },
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'github',
      externalAccountId: 'team-1',
      slug: 'github_team_1',
      displayName: 'GitHub',
      capabilities: ['source_control', 'agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}&capability=agent_tools`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toMatchObject([
      {
        provider: 'github',
        capabilities: ['agent_tools'],
      },
    ]);
  });

  it('advertises no capabilities on Linear connections before adapters exist', async () => {
    const app = await createTestApp([{provider: 'linear', displayName: 'Linear', adapters: {}}]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'linear',
      externalAccountId: 'org-1',
      slug: 'linear_org_1',
      displayName: 'Linear Org',
      capabilities: ['agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toMatchObject([
      {
        provider: 'linear',
        capabilities: [],
      },
    ]);
  });

  it('advertises agent tools on Linear module connections', async () => {
    const {provider} = await linearProviderModule.load();
    const app = await createTestApp([provider]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'linear',
      externalAccountId: 'org-1',
      slug: 'linear_org_1',
      displayName: 'Linear Org',
      capabilities: ['agent_tools'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}&capability=agent_tools`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toMatchObject([
      {
        provider: 'linear',
        capabilities: ['agent_tools'],
      },
    ]);
  });

  it('includes external_url when the provider resolves one', async () => {
    const app = await createTestApp([
      sourceProvider({
        connectionExternalUrl: () => Promise.resolve('https://gitea.local/team'),
      }),
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections[0].external_url).toBe('https://gitea.local/team');
  });

  it('omits external_url and keeps the list alive when the provider lookup throws', async () => {
    const app = await createTestApp([
      sourceProvider({
        connectionExternalUrl: () => Promise.reject(new Error('installation row missing')),
      }),
    ]);
    await upsertIntegrationConnection({
      workspaceId: context.workspaceId,
      provider: 'gitea',
      externalAccountId: 'gitea-owner',
      slug: 'gitea_owner',
      displayName: 'Gitea',
      capabilities: ['source_control'],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${context.workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toHaveLength(1);
    expect(res.json().connections[0].external_url).toBeUndefined();
  });

  it('returns membership errors', async () => {
    const app = await createTestApp([sourceProvider()]);
    const inaccessibleWorkspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/integration-connections?workspace_id=${inaccessibleWorkspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });
});
