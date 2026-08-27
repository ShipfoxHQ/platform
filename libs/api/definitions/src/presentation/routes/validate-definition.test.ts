import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {buildValidateDefinitionRoute} from './validate-definition.js';

describe('POST /definitions/validate', () => {
  let app: FastifyInstance;
  const getValidationCatalog = vi.fn(() => agentValidationCatalog);

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.post(
      '/definitions/validate',
      buildValidateDefinitionRoute({
        getValidationCatalog,
      } as never),
    );
    await app.ready();
  });

  test('valid YAML returns 200 with { valid: true }', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {
        yaml: `
name: Test
runner: ubuntu-latest
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
    expect(body.diagnostics).toEqual([]);
    expect(body.workflow_document.name).toBe('Test');
    expect(body.workflow_model.kind).toBe('workflow');
    expect(getValidationCatalog).toHaveBeenCalledWith({workspaceId: null});
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
