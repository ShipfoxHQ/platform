import {setUserContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {findMembership} from '#db/memberships.js';
import {createWorkspaceRoute} from './create.js';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

async function createUser(params: {email: string; hashedPassword?: string; name?: string}) {
  await Promise.resolve();
  return {userId: crypto.randomUUID(), email: params.email};
}

describe('POST /workspaces', () => {
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
    app.post('/workspaces', createWorkspaceRoute);
    await app.ready();
  });

  beforeEach(async () => {
    const user = await createUser({email: emailFor('caller'), hashedPassword: 'h'});
    userId = user.userId;
  });

  test('valid body returns 201 with workspace and creates membership', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {name: 'Test Workspace'},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Workspace');
    expect(body.status).toBe('active');

    const membership = await findMembership({userId, workspaceId: body.id});
    expect(membership).toBeDefined();
  });

  test('missing name returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
