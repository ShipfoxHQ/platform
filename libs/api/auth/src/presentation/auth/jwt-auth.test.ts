import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {signUserToken} from '#core/jwt.js';
import {createUser, findUserById} from '#db/users.js';
import {createJwtAuthMethod, getClientContext} from './jwt-auth.js';

const SECRET = 'test-secret';

function emailFor(suffix: string): string {
  return `${suffix}-${crypto.randomUUID()}@example.com`;
}

describe('jwt-auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const authMethod = createJwtAuthMethod();
    app.addHook('onRequest', async (request, reply) => {
      await authMethod.authenticate(request, reply);
    });

    app.get('/protected', (request) => {
      return {client: getClientContext(request)};
    });
    await app.ready();
  });

  test('decorates request.client on success', async () => {
    const user = await createUser({email: emailFor('jwt-ok'), hashedPassword: 'h'});
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      secret: SECRET,
      expiresIn: '7d',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().client.userId).toBe(user.id);
    expect(res.json().client.email).toBe(user.email);
  });

  test('401 on missing Authorization header', async () => {
    const res = await app.inject({method: 'GET', url: '/protected'});

    expect(res.statusCode).toBe(401);
  });

  test('401 on wrong scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Basic xxx'},
    });

    expect(res.statusCode).toBe(401);
  });

  test('401 on expired token', async () => {
    const user = await createUser({email: emailFor('jwt-exp'), hashedPassword: 'h'});
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      secret: SECRET,
      expiresIn: '-1s',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(401);
  });

  test('401 on tampered signature', async () => {
    const user = await createUser({email: emailFor('jwt-tamper'), hashedPassword: 'h'});
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      secret: SECRET,
      expiresIn: '7d',
    });
    const tampered = `${token.slice(0, -4)}xxxx`;

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${tampered}`},
    });

    expect(res.statusCode).toBe(401);
  });

  test('does not read user state during JWT validation', async () => {
    const userId = crypto.randomUUID();
    const email = emailFor('jwt-stateless');
    const token = await signUserToken({
      userId,
      email,
      secret: SECRET,
      expiresIn: '7d',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().client.userId).toBe(userId);
    expect(res.json().client.email).toBe(email);
  });

  // Keep helper imports referenced
  test('helpers remain available', () => {
    expect(typeof findUserById).toBe('function');
  });
});
