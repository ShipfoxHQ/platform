import {createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {describe, expect, it} from '@shipfox/vitest/vi';
import {InvalidOAuthConfigurationError} from '#core/errors.js';
import {createOAuthRoutes} from './oauth.js';

let ipCounter = 1;
const CLIENT_ID_PATTERN = /^client_[0-9a-f-]{36}$/u;

function uniqueIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

describe('OAuth route factories', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createApp({
      fastifyOptions: {trustProxy: true},
      routes: [createOAuthRoutes({apiPublicUrl: 'https://api.example.test/'})],
      swagger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves protected-resource and authorization-server metadata', async () => {
    const resource = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });
    expect(resource.statusCode).toBe(200);
    expect(resource.json()).toEqual({
      resource: 'https://api.example.test/mcp',
      authorization_servers: ['https://api.example.test'],
      scopes_supported: ['read'],
    });

    const server = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-authorization-server',
    });
    expect(server.statusCode).toBe(200);
    expect(server.json()).toEqual({
      issuer: 'https://api.example.test',
      authorization_endpoint: 'https://api.example.test/oauth/authorize',
      token_endpoint: 'https://api.example.test/oauth/token',
      registration_endpoint: 'https://api.example.test/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read'],
      client_id_metadata_document_supported: true,
    });
  });

  it('creates a public registration with no client secret', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: {'x-forwarded-for': uniqueIp()},
      payload: {
        client_name: 'Desktop agent',
        redirect_uris: ['http://127.0.0.1:43123/callback'],
      },
    });

    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({
      client_id: expect.stringMatching(CLIENT_ID_PATTERN),
      client_name: 'Desktop agent',
      redirect_uris: ['http://127.0.0.1:43123/callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'read',
    });
  });

  it('rejects non-loopback HTTP redirects', async () => {
    const result = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: {'x-forwarded-for': uniqueIp()},
      payload: {
        client_name: 'Desktop agent',
        redirect_uris: ['http://client.example/callback'],
      },
    });

    expect(result.statusCode).toBe(400);
  });

  it('rejects an invalid injected public URL before mounting routes', () => {
    expect(() => createOAuthRoutes({apiPublicUrl: 'http://api.example.test'})).toThrow(
      InvalidOAuthConfigurationError,
    );
  });

  it('returns 429 and Retry-After after the registration IP budget is exhausted', async () => {
    const ip = uniqueIp();
    const payload = {
      client_name: 'Desktop agent',
      redirect_uris: ['https://client.example/callback'],
    };

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await app.inject({
        method: 'POST',
        url: '/oauth/register',
        headers: {'x-forwarded-for': ip},
        payload,
      });
      expect(result.statusCode).toBe(201);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: {'x-forwarded-for': ip},
      payload,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toEqual(expect.any(String));
    expect(blocked.json()).toEqual({
      code: 'rate-limited',
      details: {retry_after_seconds: expect.any(Number)},
    });
  });
});
