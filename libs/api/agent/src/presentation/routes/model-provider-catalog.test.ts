import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {agentRoutes, createAgentRoutes} from './index.js';

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

    it('returns only the managed provider and the disabled policy when configured', async () => {
      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth],
        routes: createAgentRoutes(undefined as never, {
          managedProvider: managedProvider(),
          workspaceProviders: 'disabled',
        }),
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        workspace_providers: 'disabled',
        providers: [
          expect.objectContaining({
            id: 'shipfox',
            support_status: 'supported',
            default_model: 'managed-claude',
            credential_fields: [],
            models: [{id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages'}],
          }),
        ],
      });
    });
  });
});

function managedProvider(): ManagedModelProvider {
  return {
    id: 'shipfox',
    label: 'Shipfox',
    models: [{id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages'}],
    defaultModel: 'managed-claude',
    resolveCredentials: async () => ({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.com',
      credentials: {api_key: 'token'},
    }),
  };
}
