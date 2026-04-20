import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {validateDefinitionRoute} from './validate-definition.js';

describe('POST /definitions/validate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post('/definitions/validate', validateDefinitionRoute);
    await app.ready();
  });

  test('valid YAML returns 200 with { valid: true }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {
        yaml: `
name: Test
jobs:
  build:
    steps:
      - run: echo hello
`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.spec).toBeDefined();
  });

  test('invalid YAML returns 200 with { valid: false, errors }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {yaml: 'name: Bad\n  invalid:\nindentation'},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.errors).toBeDefined();
    expect(body.errors.length).toBeGreaterThan(0);
  });

  test('missing body returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});
