import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
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
      setUserContext(
        request,
        buildUserContext({
          userId,
          email: 'caller@example.com',
          name: 'Caller Person',
          memberships: [],
        }),
      );
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
      payload: {name: '  Test Workspace  ', slug: 'test-workspace'},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('Test Workspace');
    expect(body.slug).toBe('test-workspace');
    expect(body.status).toBe('active');

    const membership = await findMembership({userId, workspaceId: body.id});
    expect(membership).toBeDefined();
    expect(membership?.userName).toBe('Caller Person');
  });

  test.each([
    ['blank after trimming', '   '],
    ['with control characters', 'Test\nWorkspace'],
    ['with format characters', 'Test\u202eWorkspace'],
  ])('invalid body with %s returns 400', async (_case, name) => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {name, slug: 'test-workspace'},
    });

    expect(res.statusCode).toBe(400);
  });

  test('missing name returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {slug: 'test-workspace'},
    });

    expect(res.statusCode).toBe(400);
  });

  test('accepts a workspace slugged settings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {name: 'Settings Workspace', slug: 'settings'},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('settings');
  });

  test('returns slug-conflict for a duplicate slug', async () => {
    const slug = `duplicate-${crypto.randomUUID().slice(0, 8)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {name: 'First Workspace', slug},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/workspaces',
      payload: {name: 'Second Workspace', slug},
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('slug-conflict');
  });
});
