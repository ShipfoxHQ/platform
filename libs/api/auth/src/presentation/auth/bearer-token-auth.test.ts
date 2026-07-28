import {errorHandler} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createBearerTokenAuthMethod} from './bearer-token-auth.js';

const CONTEXT_KEY = 'testContext';

interface TestClaims {
  subject: string;
}

describe('bearer-token-auth', () => {
  let app: FastifyInstance;
  let verifyToken: ReturnType<typeof vi.fn<(token: string) => Promise<TestClaims | null>>>;
  let verifierErrorIsInvalid = true;

  beforeEach(async () => {
    verifyToken = vi.fn<(token: string) => Promise<TestClaims | null>>();
    verifierErrorIsInvalid = true;
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(errorHandler);

    const authMethod = createBearerTokenAuthMethod({
      name: 'test-bearer',
      verifyToken,
      isInvalidTokenError: () => verifierErrorIsInvalid,
      invalidTokenError: {message: 'Invalid test bearer token', code: 'invalid-test-token'},
      setContext: (request, claims) => {
        (request as FastifyRequest & Record<typeof CONTEXT_KEY, typeof claims>)[CONTEXT_KEY] =
          claims;
      },
    });

    app.addHook('onRequest', async (request, reply) => {
      await authMethod.authenticate(request, reply);
    });

    app.get('/protected', (request) => {
      return {
        context: (request as FastifyRequest & Record<typeof CONTEXT_KEY, unknown>)[CONTEXT_KEY],
      };
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test('valid bearer token sets context on the request', async () => {
    verifyToken.mockResolvedValue({subject: 'runner-1'});

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer valid-token'},
    });

    expect(res.statusCode).toBe(200);
    expect(verifyToken).toHaveBeenCalledWith('valid-token');
    expect(res.json().context).toEqual({subject: 'runner-1'});
  });

  test('missing bearer token returns the shared unauthorized response', async () => {
    const res = await app.inject({method: 'GET', url: '/protected'});

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({code: 'unauthorized'});
    expect(verifyToken).not.toHaveBeenCalled();
  });

  test('invalid bearer token returns the configured unauthorized response', async () => {
    verifyToken.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer invalid-token'},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({code: 'invalid-test-token'});
    expect(verifyToken).toHaveBeenCalledWith('invalid-token');
  });

  test('thrown verifier errors return the configured unauthorized response', async () => {
    verifyToken.mockRejectedValue(new Error('bad signature'));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer invalid-token'},
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({code: 'invalid-test-token'});
    expect(verifyToken).toHaveBeenCalledWith('invalid-token');
  });

  test('propagates verifier errors classified as service failures', async () => {
    verifierErrorIsInvalid = false;
    verifyToken.mockRejectedValue(new Error('database unavailable'));

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: {authorization: 'Bearer valid-token'},
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().code).not.toBe('invalid-test-token');
  });
});
