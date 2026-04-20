import {z} from 'zod';
import {closeApp, createApp, defineRoute} from './index.js';
import type {RouteGroup} from './types.js';

afterEach(async () => {
  await closeApp();
});

describe('route mounting', () => {
  test('single route is mounted', async () => {
    const app = await createApp({
      routes: [
        {method: 'GET', path: '/hello', description: 'Say hello', handler: () => ({msg: 'hello'})},
      ],
    });
    const res = await app.inject({method: 'GET', url: '/hello'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({msg: 'hello'});
  });

  test('route group applies prefix', async () => {
    const app = await createApp({
      routes: [
        {
          prefix: '/api',
          routes: [
            {
              method: 'GET',
              path: '/users',
              description: 'List users',
              handler: () => ({users: []}),
            },
          ],
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/api/users'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({users: []});
  });

  test('nested groups compound prefixes', async () => {
    const app = await createApp({
      routes: [
        {
          prefix: '/api',
          routes: [
            {
              prefix: '/v1',
              routes: [
                {
                  prefix: '/users',
                  routes: [
                    {
                      method: 'GET',
                      path: '/',
                      description: 'Nested route',
                      handler: () => ({nested: true}),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/api/v1/users/'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({nested: true});
  });

  test('auth inheritance — route inherits group auth', async () => {
    const authCalled: string[] = [];
    const app = await createApp({
      auth: [
        {
          name: 'client',
          authenticate: () => {
            authCalled.push('client');
            return Promise.resolve();
          },
        },
      ],
      routes: [
        {
          prefix: '/api',
          auth: 'client',
          routes: [
            {method: 'GET', path: '/data', description: 'Get data', handler: () => ({ok: true})},
          ],
        },
      ],
    });
    await app.inject({method: 'GET', url: '/api/data'});
    expect(authCalled).toEqual(['client']);
  });

  test('auth override — route auth replaces group auth', async () => {
    const authCalled: string[] = [];
    const app = await createApp({
      auth: [
        {
          name: 'client',
          authenticate: () => {
            authCalled.push('client');
            return Promise.resolve();
          },
        },
        {
          name: 'admin',
          authenticate: () => {
            authCalled.push('admin');
            return Promise.resolve();
          },
        },
      ],
      routes: [
        {
          prefix: '/api',
          auth: 'client',
          routes: [
            {
              method: 'GET',
              path: '/admin-only',
              description: 'Admin only endpoint',
              auth: 'admin',
              handler: () => ({ok: true}),
            },
          ],
        },
      ],
    });
    await app.inject({method: 'GET', url: '/api/admin-only'});
    expect(authCalled).toEqual(['admin']);
  });

  test('route with custom error handler', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/fail',
          description: 'Fail with custom error',
          handler: () => {
            throw new Error('boom');
          },
          errorHandler: (_error, _request, reply) => {
            reply.code(418).send({custom: true});
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/fail'});
    expect(res.statusCode).toBe(418);
    expect(res.json()).toEqual({custom: true});
  });

  test('global error handler catches unhandled errors', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/fail',
          description: 'Fail with unhandled error',
          handler: () => {
            throw new Error('unhandled');
          },
        },
      ],
      errorHandler: (_error, _request, reply) => {
        reply.code(500).send({global: true});
      },
    });
    const res = await app.inject({method: 'GET', url: '/fail'});
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({global: true});
  });

  test('route options are applied', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/small',
          description: 'Small body limit',
          options: {bodyLimit: 10},
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/small',
      payload: {data: 'x'.repeat(100)},
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({code: 'body-too-large'});
  });
});

describe('schema validation', () => {
  test('zod body schema validates input', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/users',
          description: 'Create user',
          schema: {body: z.object({name: z.string()})},
          handler: (req) => ({name: (req.body as {name: string}).name}),
        },
      ],
    });

    const good = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {name: 'Alice'},
    });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({name: 'Alice'});

    const bad = await app.inject({
      method: 'POST',
      url: '/users',
      payload: {name: 123},
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('plugin escape hatch', () => {
  test('global plugins are registered', async () => {
    const app = await createApp({
      plugins: [
        (fastify, _opts, done) => {
          fastify.get('/from-plugin', () => ({plugin: true}));
          done();
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/from-plugin'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({plugin: true});
  });

  test('group plugins are scoped to prefix', async () => {
    const group: RouteGroup = {
      prefix: '/scoped',
      routes: [],
      plugins: [
        (fastify, _opts, done) => {
          fastify.get('/plugin-route', () => ({scoped: true}));
          done();
        },
      ],
    };
    const app = await createApp({routes: [group]});

    const scoped = await app.inject({method: 'GET', url: '/scoped/plugin-route'});
    expect(scoped.statusCode).toBe(200);

    const unscoped = await app.inject({method: 'GET', url: '/plugin-route'});
    expect(unscoped.statusCode).toBe(404);
  });
});

describe('defineRoute', () => {
  test('returns a valid route definition', async () => {
    const route = defineRoute({
      method: 'POST',
      path: '/typed',
      description: 'Typed route',
      schema: {body: z.object({value: z.number()})},
      handler: async (req) => ({doubled: req.body.value * 2}),
    });

    const app = await createApp({routes: [route]});
    const res = await app.inject({
      method: 'POST',
      url: '/typed',
      payload: {value: 21},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({doubled: 42});
  });
});

describe('async handlers', () => {
  test('async route handler works', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/async',
          description: 'Async handler',
          handler: async () => {
            const result = await Promise.resolve({msg: 'async'});
            return result;
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/async'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({msg: 'async'});
  });

  test('async handler rejection is caught by error handler', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/async-fail',
          description: 'Async fail',
          handler: async () => {
            await Promise.resolve();
            throw new Error('async boom');
          },
        },
      ],
      errorHandler: (_error, _request, reply) => {
        reply.code(500).send({caught: true});
      },
    });
    const res = await app.inject({method: 'GET', url: '/async-fail'});
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({caught: true});
  });

  test('async handler with auth and schema', async () => {
    const app = await createApp({
      auth: [
        {
          name: 'token',
          authenticate: (request) => {
            (request as unknown as Record<string, unknown>).userId = 'u1';
            return Promise.resolve();
          },
        },
      ],
      routes: [
        {
          method: 'POST',
          path: '/async-full',
          description: 'Async with auth and schema',
          auth: 'token',
          schema: {body: z.object({input: z.string()})},
          handler: async (request) => {
            const body = request.body as {input: string};
            const userId = (request as unknown as Record<string, unknown>).userId;
            const result = await Promise.resolve(`${userId}:${body.input}`);
            return {result};
          },
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/async-full',
      payload: {input: 'hello'},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({result: 'u1:hello'});
  });
});
