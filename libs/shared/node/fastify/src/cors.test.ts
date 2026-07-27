import {ClientError, closeApp, createApp, defineRoute} from './index.js';

const testConfig = vi.hoisted(() => ({
  allowedOrigin: undefined as string | undefined,
  clientBaseUrl: 'https://app.example.test',
}));

vi.mock('./config.js', () => ({
  config: {
    get BROWSER_ALLOWED_ORIGIN() {
      return testConfig.allowedOrigin;
    },
    get CLIENT_BASE_URL() {
      return testConfig.clientBaseUrl;
    },
    HOST: '0.0.0.0',
    PORT: 3000,
  },
}));

beforeEach(() => {
  testConfig.allowedOrigin = undefined;
  testConfig.clientBaseUrl = 'https://app.example.test';
});

afterEach(async () => {
  await closeApp();
});

describe('global browser CORS', () => {
  test('allows the configured browser origin with credentials', async () => {
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'POST',
          path: '/auth/example',
          description: 'Test route',
          handler: () => ({ok: true}),
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/example',
      headers: {
        origin: testConfig.clientBaseUrl,
        'access-control-request-method': 'POST',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(testConfig.clientBaseUrl);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('allows mutating browser methods used by client APIs', async () => {
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'DELETE',
          path: '/workspaces/:workspaceId/invitations/:invitationId',
          description: 'Test delete route',
          handler: () => undefined,
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/workspaces/workspace-1/invitations/invitation-1',
      headers: {
        origin: testConfig.clientBaseUrl,
        'access-control-request-method': 'DELETE',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(testConfig.clientBaseUrl);
    expect(res.headers['access-control-allow-methods']).toContain('DELETE');
  });

  test('normalizes configured origins and applies CORS headers on error responses', async () => {
    testConfig.allowedOrigin = 'http://localhost:5173/, http://127.0.0.1:5173';
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'POST',
          path: '/auth/refresh',
          description: 'Test refresh',
          handler: () => {
            throw new ClientError('Unauthorized', 'unauthorized', {status: 401});
          },
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        origin: 'http://localhost:5173',
      },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  test('allows a subdomain wildcard without allowing its parent or a lookalike host', async () => {
    testConfig.allowedOrigin = 'https://*.example-preview.pages.dev';
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'POST',
          path: '/auth/example',
          description: 'Test route',
          handler: () => ({ok: true}),
        }),
      ],
      swagger: false,
    });

    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/auth/example',
      headers: {
        origin: 'https://abc123.example-preview.pages.dev',
        'access-control-request-method': 'POST',
      },
    });
    const parent = await app.inject({
      method: 'OPTIONS',
      url: '/auth/example',
      headers: {
        origin: 'https://example-preview.pages.dev',
        'access-control-request-method': 'POST',
      },
    });
    const lookalike = await app.inject({
      method: 'OPTIONS',
      url: '/auth/example',
      headers: {
        origin: 'https://example-preview.pages.dev.evil.test',
        'access-control-request-method': 'POST',
      },
    });

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://abc123.example-preview.pages.dev',
    );
    expect(parent.headers['access-control-allow-origin']).toBeUndefined();
    expect(lookalike.headers['access-control-allow-origin']).toBeUndefined();
  });

  test.each([
    ['https://*.pages.dev', 'public suffix'],
    ['https://preview.*.pages.dev', 'leftmost hostname label'],
    ['https://*.*.example-preview.pages.dev', 'leftmost hostname label'],
    ['https://*.example-preview.pages.dev@evil.test', 'hostname'],
    ['https://example.test/path/*', 'hostname'],
    ['https://example.test/?wildcard=*', 'hostname'],
    ['https://*./', 'well-formed parent host'],
    ['https://*..com', 'well-formed parent host'],
    ['https://*.a..b.com', 'well-formed parent host'],
  ])('rejects unsafe wildcard origin %s (%s)', async (origin, message) => {
    testConfig.allowedOrigin = origin;

    await expect(createApp({swagger: false})).rejects.toThrow(message);
  });

  test('does not grant a disallowed origin', async () => {
    const app = await createApp({
      routes: [
        defineRoute({
          method: 'POST',
          path: '/auth/example',
          description: 'Test route',
          handler: () => ({ok: true}),
        }),
      ],
      swagger: false,
    });

    const res = await app.inject({
      method: 'OPTIONS',
      url: '/auth/example',
      headers: {
        origin: 'https://evil.example.test',
        'access-control-request-method': 'POST',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
