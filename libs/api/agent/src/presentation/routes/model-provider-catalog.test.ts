import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {agentRoutes} from './index.js';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: [],
      }),
    );
    return Promise.resolve();
  },
};

describe('model provider catalog route', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    await closeApp();
    app = await createApp({
      auth: [fakeUserAuth],
      routes: agentRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  describe('GET /agent/model-provider-catalog', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns model providers with supported models and unsupported empty model lists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().providers).toHaveLength(37);
      for (const provider of res.json().providers) {
        if (provider.support_status === 'supported') {
          expect(provider.models.length).toBeGreaterThan(0);
          expect(
            provider.models.some((model: {id: string}) => model.id === provider.default_model),
          ).toBe(true);
        } else {
          expect(provider.models).toEqual([]);
        }
      }
    });
  });
});
