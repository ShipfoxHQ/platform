import {setApiKeyContext} from '@shipfox/api-auth-context';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {createDefinitionRoute} from './create-definition.js';

vi.mock('@shipfox/api-projects', () => ({
  ProjectNotFoundError: class ProjectNotFoundError extends Error {},
  requireProjectForWorkspace: vi.fn(({projectId, workspaceId}) =>
    Promise.resolve({id: projectId, workspaceId}),
  ),
}));

describe('POST /api/definitions', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setApiKeyContext(request, {
        apiKeyId: crypto.randomUUID(),
        workspaceId,
        workspaceStatus: 'active',
        scopes: ['*'],
      });
      done();
    });
    app.post('/api/definitions', createDefinitionRoute);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  const validYaml = `
name: Test Workflow
jobs:
  build:
    steps:
      - run: echo hello
`;

  test('valid YAML returns 200 with definition response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: '.shipfox/workflows/test.yml', yaml: validYaml},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.project_id).toBe(projectId);
    expect(body.config_path).toBe('.shipfox/workflows/test.yml');
    expect(body.source).toBe('manual');
    expect(body.name).toBe('Test Workflow');
    expect(body.definition).toBeDefined();
    expect(body.sha).toBeNull();
    expect(body.ref).toBeNull();
    expect(body.fetched_at).toBeDefined();
  });

  test('invalid YAML syntax returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: 'test.yml',
        yaml: 'name: Bad\n  invalid:\nindentation',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test('valid YAML with invalid spec returns 400 with error code', async () => {
    const yamlMissingName = `
jobs:
  build:
    steps:
      - run: echo hello
`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml: yamlMissingName},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-definition-spec');
  });

  test('cyclic DAG returns 400 with dag error code', async () => {
    const cyclicYaml = `
name: Cyclic
jobs:
  a:
    needs: b
    steps:
      - run: echo a
  b:
    needs: a
    steps:
      - run: echo b
`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml: cyclicYaml},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-definition-spec');
  });

  test('upsert same config_path updates the definition', async () => {
    const payload1 = {project_id: projectId, config_path: 'deploy.yml', yaml: validYaml};

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: payload1,
    });

    const updatedYaml = `
name: Updated Workflow
jobs:
  deploy:
    steps:
      - run: ./deploy.sh
`;
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'deploy.yml', yaml: updatedYaml},
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().id).toBe(res1.json().id);
    expect(res2.json().name).toBe('Updated Workflow');
  });

  test('missing body fields returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  test('invalid projectId UUID returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: 'not-a-uuid', config_path: 'test.yml', yaml: validYaml},
    });

    expect(res.statusCode).toBe(400);
  });

  test('creates a manual definition without a config path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, yaml: validYaml},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().config_path).toBeNull();
    expect(res.json().source).toBe('manual');
  });

  test('rejects a VCS definition without a config path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, source: 'vcs', yaml: validYaml},
    });

    expect(res.statusCode).toBe(400);
  });
});
