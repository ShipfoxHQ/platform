import {closeApp, createApp} from './index.js';
import type {AuthMethod} from './types.js';

afterEach(async () => {
  await closeApp();
});

function createMockAuth(name: string, shouldPass = true): AuthMethod {
  return {
    name,
    authenticate: (request) => {
      if (!shouldPass) {
        throw new Error(`${name} auth failed`);
      }
      (request as unknown as Record<string, unknown>)[`${name}Verified`] = true;
      return Promise.resolve();
    },
  };
}

describe('auth', () => {
  test('route with auth rejects when authenticate throws', async () => {
    const app = await createApp({
      auth: [createMockAuth('client', false)],
      routes: [
        {
          method: 'GET',
          path: '/protected',
          description: 'Protected route',
          auth: 'client',
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/protected'});
    expect(res.statusCode).toBe(500);
  });

  test('route with auth allows when authenticate succeeds', async () => {
    const app = await createApp({
      auth: [createMockAuth('client')],
      routes: [
        {
          method: 'GET',
          path: '/protected',
          description: 'Protected route',
          auth: 'client',
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/protected'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true});
  });

  test('unknown auth method throws at startup', async () => {
    await expect(
      createApp({
        auth: [],
        routes: [
          {
            method: 'GET',
            path: '/test',
            description: 'Test route',
            auth: 'nonexistent',
            handler: () => ({}),
          },
        ],
      }),
    ).rejects.toThrow("Unknown auth method: 'nonexistent'");
  });

  test('multiple auth methods run sequentially', async () => {
    const order: string[] = [];
    const app = await createApp({
      auth: [
        {
          name: 'first',
          authenticate: () => {
            order.push('first');
            return Promise.resolve();
          },
        },
        {
          name: 'second',
          authenticate: () => {
            order.push('second');
            return Promise.resolve();
          },
        },
      ],
      routes: [
        {
          method: 'GET',
          path: '/multi',
          description: 'Multi auth route',
          auth: ['first', 'second'],
          handler: () => ({ok: true}),
        },
      ],
    });
    await app.inject({method: 'GET', url: '/multi'});
    expect(order).toEqual(['first', 'second']);
  });

  test('auth method can mutate request state', async () => {
    const app = await createApp({
      auth: [
        {
          name: 'jwt',
          authenticate: (request) => {
            (request as unknown as Record<string, unknown>).user = {id: '123'};
            return Promise.resolve();
          },
        },
      ],
      routes: [
        {
          method: 'GET',
          path: '/me',
          description: 'Current user',
          auth: 'jwt',
          handler: (request) => ({
            user: (request as unknown as Record<string, unknown>).user,
          }),
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/me'});
    expect(res.json()).toEqual({user: {id: '123'}});
  });

  test('auth is cleared between createApp calls', async () => {
    await createApp({
      auth: [createMockAuth('leaked')],
      routes: [],
    });

    await expect(
      createApp({
        auth: [],
        routes: [
          {
            method: 'GET',
            path: '/test',
            description: 'Test route',
            auth: 'leaked',
            handler: () => ({}),
          },
        ],
      }),
    ).rejects.toThrow("Unknown auth method: 'leaked'");
  });
});
