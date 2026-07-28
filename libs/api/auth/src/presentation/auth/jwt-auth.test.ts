import {userAccessTokenKey} from '@shipfox/node-auth-root-key';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {signUserToken} from '#core/jwt.js';
import {
  createRefreshToken,
  revokeRefreshTokenByHash,
  rotateRefreshToken,
} from '#db/refresh-tokens.js';
import {createUser, findUserById} from '#db/users.js';
import {createJwtAuthMethod, getAuthenticatedSessionContext, getClientContext} from './jwt-auth.js';

const SECRET = userAccessTokenKey();

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
    app.get('/session', async (request) => await getAuthenticatedSessionContext(request));
    await app.ready();
  });

  test('decorates request.client on success', async () => {
    const user = await createUser({email: emailFor('jwt-ok'), hashedPassword: 'h'});
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      name: 'JWT User',
      memberships: [],
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
    expect(res.json().client.name).toBe('JWT User');
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
      memberships: [],
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
      memberships: [],
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

  test('keeps a legacy token verifiable during the migration window', async () => {
    const userId = crypto.randomUUID();
    const email = emailFor('jwt-stateless');
    const token = await signUserToken({
      userId,
      email,
      memberships: [],
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

  test('resolves the active refresh-session identity from an authenticated request', async () => {
    const user = await createUser({email: emailFor('jwt-session'), hashedPassword: 'h'});
    const rawRefreshToken = `refresh-${crypto.randomUUID()}`;
    const refreshToken = await createRefreshToken({
      userId: user.id,
      hashedToken: hashOpaqueToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const initialToken = await signUserToken({
      userId: user.id,
      email: user.email,
      memberships: [],
      refreshSessionId: refreshToken.sessionId,
      secret: SECRET,
      expiresIn: '7d',
    });
    await rotateRefreshToken({
      id: refreshToken.id,
      currentHashedToken: hashOpaqueToken(rawRefreshToken),
      nextHashedToken: hashOpaqueToken(`refresh-${crypto.randomUUID()}`),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const refreshedToken = await signUserToken({
      userId: user.id,
      email: user.email,
      memberships: [],
      refreshSessionId: refreshToken.sessionId,
      secret: SECRET,
      expiresIn: '7d',
    });

    const initial = await app.inject({
      method: 'GET',
      url: '/session',
      headers: {authorization: `Bearer ${initialToken}`},
    });
    const refreshed = await app.inject({
      method: 'GET',
      url: '/session',
      headers: {authorization: `Bearer ${refreshedToken}`},
    });

    expect(initial.statusCode).toBe(200);
    expect(refreshed.statusCode).toBe(200);
    expect(initial.json()).toEqual({userId: user.id, refreshSessionId: refreshToken.sessionId});
    expect(refreshed.json()).toEqual(initial.json());
  });

  test('rejects an authenticated token after its refresh session is revoked', async () => {
    const user = await createUser({email: emailFor('jwt-session-revoked'), hashedPassword: 'h'});
    const rawRefreshToken = `refresh-${crypto.randomUUID()}`;
    const refreshToken = await createRefreshToken({
      userId: user.id,
      hashedToken: hashOpaqueToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      memberships: [],
      refreshSessionId: refreshToken.sessionId,
      secret: SECRET,
      expiresIn: '7d',
    });
    await revokeRefreshTokenByHash({hashedToken: hashOpaqueToken(rawRefreshToken)});

    const res = await app.inject({
      method: 'GET',
      url: '/session',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(401);
  });

  test('rejects an authenticated token without a refresh-session claim', async () => {
    const user = await createUser({email: emailFor('jwt-old-format'), hashedPassword: 'h'});
    const token = await signUserToken({
      userId: user.id,
      email: user.email,
      memberships: [],
      secret: SECRET,
      expiresIn: '7d',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/session',
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(401);
  });

  test('helpers remain available', () => {
    expect(typeof findUserById).toBe('function');
  });
});
