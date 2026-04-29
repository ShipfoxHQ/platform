import {closeApp, createApp, defineRoute} from '@shipfox/node-fastify';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {createE2eAdminAuthMethod, createE2eRouteGroup} from './e2e.js';

const pingRoute = defineRoute({
  method: 'POST',
  path: '/ping',
  description: 'E2E test route.',
  handler: () => ({ok: true}),
});

describe('E2E route gating', () => {
  afterEach(async () => {
    await closeApp();
  });

  it('does not mount E2E routes when E2E is disabled', async () => {
    const app = await createApp({
      auth: [createE2eAdminAuthMethod({E2E_ENABLED: false, E2E_ADMIN_API_KEY: 'secret'})],
      routes: createE2eRouteGroup([pingRoute], {E2E_ENABLED: false, E2E_ADMIN_API_KEY: 'secret'}),
      swagger: false,
    });

    const res = await app.inject({method: 'POST', url: '/__e2e/ping'});

    expect(res.statusCode).toBe(404);
  });

  it('does not mount E2E routes when the admin key is missing', async () => {
    const app = await createApp({
      auth: [createE2eAdminAuthMethod({E2E_ENABLED: true})],
      routes: createE2eRouteGroup([pingRoute], {E2E_ENABLED: true}),
      swagger: false,
    });

    const res = await app.inject({method: 'POST', url: '/__e2e/ping'});

    expect(res.statusCode).toBe(404);
  });

  it('rejects missing E2E admin bearer tokens', async () => {
    const app = await createApp({
      auth: [createE2eAdminAuthMethod({E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'})],
      routes: createE2eRouteGroup([pingRoute], {E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'}),
      swagger: false,
    });

    const res = await app.inject({method: 'POST', url: '/__e2e/ping'});

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid E2E admin bearer tokens', async () => {
    const app = await createApp({
      auth: [createE2eAdminAuthMethod({E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'})],
      routes: createE2eRouteGroup([pingRoute], {E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'}),
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/__e2e/ping',
      headers: {authorization: 'Bearer wrong'},
    });

    expect(res.statusCode).toBe(401);
  });

  it('allows valid E2E admin bearer tokens', async () => {
    const app = await createApp({
      auth: [createE2eAdminAuthMethod({E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'})],
      routes: createE2eRouteGroup([pingRoute], {E2E_ENABLED: true, E2E_ADMIN_API_KEY: 'secret'}),
      swagger: false,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/__e2e/ping',
      headers: {authorization: 'Bearer secret'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ok: true});
  });
});
