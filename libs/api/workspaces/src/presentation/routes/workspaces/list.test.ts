import {setUserContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createMembership} from '#db/memberships.js';
import {createWorkspace} from '#db/workspaces.js';
import {listUserWorkspacesRoute} from './list.js';

describe('GET /workspaces', () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(request, {userId, email: 'caller@example.com'});
      done();
    });
    app.get('/workspaces', listUserWorkspacesRoute);
    await app.ready();
  });

  beforeEach(() => {
    userId = crypto.randomUUID();
  });

  test('returns the signed-in user workspace memberships', async () => {
    const workspace = await createWorkspace({name: 'Acme'});
    await createMembership({
      userId,
      userEmail: 'caller@example.com',
      workspaceId: workspace.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/workspaces',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      memberships: [
        {
          user_id: userId,
          workspace_id: workspace.id,
          workspace_name: 'Acme',
        },
      ],
    });
  });
});
