import {z} from 'zod';
import {ClientError} from './clientError.js';
import {closeApp, createApp} from './index.js';

afterEach(async () => {
  await closeApp();
});

describe('default error handler', () => {
  test('ClientError returns its code and defaults to 400', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/client-err',
          description: 'client error test',
          handler: () => {
            throw new ClientError('not found', 'resource-not-found');
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/client-err'});
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({code: 'resource-not-found'});
  });

  test('ClientError uses custom status when provided', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/forbidden',
          description: 'forbidden test',
          handler: () => {
            throw new ClientError('forbidden', 'forbidden', {status: 403});
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/forbidden'});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({code: 'forbidden'});
  });

  test('ClientError does not leak data or message to client', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/secret',
          description: 'no-leak test',
          handler: () => {
            throw new ClientError('internal details', 'bad-request', {
              data: {userId: '123'},
            });
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/secret'});
    const body = res.json();
    expect(body).toEqual({code: 'bad-request'});
    expect(body.message).toBeUndefined();
    expect(body.data).toBeUndefined();
  });

  test('schema validation error returns 400 with validation-error code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/validated',
          description: 'body validation test',
          schema: {body: z.object({email: z.string().email()})},
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: {email: 'not-an-email'},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation-error');
    expect(res.json().message).toContain('body');
  });

  test('schema validation on querystring returns 400', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/search',
          description: 'querystring validation test',
          schema: {querystring: z.object({page: z.coerce.number().int().positive()})},
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/search?page=-1'});
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('validation-error');
    expect(res.json().message).toContain('querystring');
  });

  test('unknown route returns 404 with not-found code', async () => {
    const app = await createApp({routes: []});
    const res = await app.inject({method: 'GET', url: '/does-not-exist'});
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({code: 'not-found'});
  });

  test('invalid content-type returns 415 with invalid-media-type code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/json-only',
          description: 'content-type test',
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/json-only',
      headers: {'content-type': 'text/xml'},
      payload: '<xml />',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({code: 'invalid-media-type'});
  });

  test('invalid JSON body returns 400 with invalid-json-body code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/parse',
          description: 'invalid JSON test',
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/parse',
      headers: {'content-type': 'application/json'},
      payload: '{invalid json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({code: 'invalid-json-body'});
  });

  test('empty JSON body returns 400 with empty-json-body code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'POST',
          path: '/needs-body',
          description: 'empty body test',
          handler: () => ({ok: true}),
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/needs-body',
      headers: {'content-type': 'application/json'},
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({code: 'empty-json-body'});
  });

  test('handler timeout returns 408 with handler-timeout code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/slow',
          description: 'timeout test',
          options: {handlerTimeout: 1},
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return {ok: true};
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/slow'});
    expect(res.statusCode).toBe(408);
    expect(res.json()).toEqual({code: 'handler-timeout'});
  });

  test('unhandled error returns 500 with server-error code', async () => {
    const app = await createApp({
      routes: [
        {
          method: 'GET',
          path: '/boom',
          description: 'unhandled error test',
          handler: () => {
            throw new Error('unexpected');
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/boom'});
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({code: 'server-error'});
  });
});
