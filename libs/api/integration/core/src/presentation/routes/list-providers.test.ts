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
      'debug',
    ]);
  });
});
