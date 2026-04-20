import {closeApp, createApp} from './index.js';

afterEach(async () => {
  await closeApp();
});

describe('health checks', () => {
  test('GET /healthz returns 200 with no checks', async () => {
    const app = await createApp();
    const res = await app.inject({method: 'GET', url: '/healthz'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({status: 'ok', checks: {}});
  });

  test('GET /readyz returns 200 with no checks', async () => {
    const app = await createApp();
    const res = await app.inject({method: 'GET', url: '/readyz'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({status: 'ok', checks: {}});
  });

  test('GET /healthz returns 200 when all liveness checks pass', async () => {
    const app = await createApp({
      livenessChecks: [{name: 'db', check: () => true}],
    });
    const res = await app.inject({method: 'GET', url: '/healthz'});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({status: 'ok', checks: {db: 'ok'}});
  });

  test('GET /healthz returns 503 when a liveness check fails', async () => {
    const app = await createApp({
      livenessChecks: [
        {name: 'db', check: () => true},
        {name: 'cache', check: () => false},
      ],
    });
    const res = await app.inject({method: 'GET', url: '/healthz'});
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'error',
      checks: {db: 'ok', cache: 'error'},
    });
  });

  test('GET /readyz returns 503 when a readiness check fails', async () => {
    const app = await createApp({
      readinessChecks: [{name: 'postgres', check: () => false}],
    });
    const res = await app.inject({method: 'GET', url: '/readyz'});
    expect(res.statusCode).toBe(503);
  });

  test('health check that throws is treated as failure', async () => {
    const app = await createApp({
      readinessChecks: [
        {
          name: 'broken',
          check: () => {
            throw new Error('connection refused');
          },
        },
      ],
    });
    const res = await app.inject({method: 'GET', url: '/readyz'});
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.broken).toBe('error');
  });

  test('async health checks work', async () => {
    const app = await createApp({
      readinessChecks: [{name: 'async-check', check: async () => true}],
    });
    const res = await app.inject({method: 'GET', url: '/readyz'});
    expect(res.statusCode).toBe(200);
  });
});
