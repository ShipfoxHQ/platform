import {z} from 'zod';
import {closeApp, createApp} from './index.js';
import {defineRoute} from './types.js';

afterEach(async () => {
  await closeApp();
});

describe('createApp lifecycle', () => {
  test('createApp with no config creates bare app with health endpoints', async () => {
    const app = await createApp();
    const health = await app.inject({method: 'GET', url: '/healthz'});
    expect(health.statusCode).toBe(200);
  });

  test('empty routes array works', async () => {
    const app = await createApp({routes: []});
    const health = await app.inject({method: 'GET', url: '/healthz'});
    expect(health.statusCode).toBe(200);
  });

  test('openapi.json renders zod route schemas', async () => {
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'GET',
          path: '/items',
          description: 'List items',
          schema: {
            querystring: z.object({
              name: z.string().min(1),
            }),
            response: {
              200: z.object({
                ok: z.boolean(),
              }),
            },
          },
          handler: () => ({ok: true}),
        }),
      ],
    });

    const response = await app.inject({method: 'GET', url: '/openapi.json'});

    expect(response.statusCode).toBe(200);
    expect(response.json().paths['/items'].get.parameters).toContainEqual(
      expect.objectContaining({in: 'query', name: 'name', type: 'string'}),
    );
  });
});
