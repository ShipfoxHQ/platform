import {giteaProviderModule} from '#providers/gitea.js';
import {linearProviderModule} from '#providers/linear.js';
import {createTestApp, sourceProvider, useIntegrationRouteTest} from '#test/route-utils.js';

describe('GET /integration-providers', () => {
  useIntegrationRouteTest();

  it('requires user auth', async () => {
    const app = await createTestApp([sourceProvider()]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers',
    });

    expect(res.statusCode).toBe(401);
  });

  it('lists providers by capability', async () => {
    const app = await createTestApp([
      sourceProvider(),
      {
        provider: 'github',
        displayName: 'GitHub',
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers?capability=source_control',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers.map((provider: {provider: string}) => provider.provider)).toEqual([
      'gitea',
    ]);
  });

  it('lists providers with agent tools capability', async () => {
    const app = await createTestApp([
      sourceProvider(),
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

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers?capability=agent_tools',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toEqual([
      {
        provider: 'github',
        display_name: 'GitHub',
        capabilities: ['agent_tools'],
      },
    ]);
  });

  it('surfaces the gitea provider once its module is registered', async () => {
    const {provider} = await giteaProviderModule.load();
    const app = await createTestApp([provider]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toContainEqual({
      provider: 'gitea',
      display_name: 'Gitea',
      capabilities: ['source_control', 'agent_tools'],
    });
  });

  it('surfaces the Linear provider with agent tools once its module is registered', async () => {
    const {provider} = await linearProviderModule.load();
    const app = await createTestApp([provider]);

    const res = await app.inject({
      method: 'GET',
      url: '/integration-providers',
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toContainEqual({
      provider: 'linear',
      display_name: 'Linear',
      capabilities: ['agent_tools'],
    });
  });
});
