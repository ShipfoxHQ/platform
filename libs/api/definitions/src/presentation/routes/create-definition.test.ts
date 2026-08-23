import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {buildCreateDefinitionRoute} from './create-definition.js';

const getProjectById = vi.fn();
const projects = {getProjectById} as Pick<ProjectsModuleClient, 'getProjectById'>;
const agent = {getValidationCatalog: vi.fn(() => agentValidationCatalog)};

describe('POST /api/definitions', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let sourceConnectionId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    app.post(
      '/api/definitions',
      buildCreateDefinitionRoute({
        projects: projects as ProjectsModuleClient,
        agent: agent as never,
      }),
    );
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    getProjectById.mockResolvedValue({
      project: {id: projectId, workspaceId, sourceConnectionId},
    } as never);
  });

  const validYaml = `
name: Test Workflow
runner: ubuntu-latest
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
    expect(body.workflow_document.name).toBe('Test Workflow');
    expect(body.workflow_model.kind).toBe('workflow');
    expect(body.sha).toBeNull();
    expect(body.ref).toBeNull();
    expect(body.fetched_at).toBeDefined();
  });

  test('skips connection snapshot loading when YAML has no integrations', async () => {
    const getAgentToolsContext = vi.fn();
    const appWithOptions = Fastify();
    appWithOptions.setValidatorCompiler(validatorCompiler);
    appWithOptions.setSerializerCompiler(serializerCompiler);
    appWithOptions.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    appWithOptions.post(
      '/api/definitions',
      buildCreateDefinitionRoute({
        projects: projects as ProjectsModuleClient,
        agent: agent as never,
        integrations: {getAgentToolsContext} as Pick<
          IntegrationsModuleClient,
          'getAgentToolsContext'
        > as IntegrationsModuleClient,
      }),
    );
    await appWithOptions.ready();

    const res = await appWithOptions.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: '.shipfox/workflows/test.yml',
        yaml: validYaml,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(getAgentToolsContext).not.toHaveBeenCalled();
  });

  test('uses the project source connection as the default integration connection', async () => {
    const getAgentToolsContext = vi.fn(() =>
      Promise.resolve({
        selectionCatalogs: [
          {
            provider: 'github',
            selectors: [
              {
                token: 'issue_read',
                kind: 'family' as const,
                sensitivity: 'read' as const,
                sensitive: false,
              },
            ],
          },
        ],
        catalogs: [],
        workspaceConnections: [
          {
            id: sourceConnectionId,
            slug: 'github-main',
            provider: 'github',
            capabilities: ['agent_tools' as const],
          },
        ],
        defaultConnection: {
          id: sourceConnectionId,
          slug: 'github-main',
          provider: 'github',
        },
      }),
    );
    const appWithOptions = Fastify();
    appWithOptions.setValidatorCompiler(validatorCompiler);
    appWithOptions.setSerializerCompiler(serializerCompiler);
    appWithOptions.addHook('onRequest', (request, _reply, done) => {
      setUserContext(
        request,
        buildUserContext({
          userId: crypto.randomUUID(),
          email: 'user@example.com',
          memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
        }),
      );
      done();
    });
    appWithOptions.post(
      '/api/definitions',
      buildCreateDefinitionRoute({
        projects: projects as ProjectsModuleClient,
        agent: agent as never,
        integrations: {getAgentToolsContext} as Pick<
          IntegrationsModuleClient,
          'getAgentToolsContext'
        > as IntegrationsModuleClient,
      }),
    );
    await appWithOptions.ready();

    const res = await appWithOptions.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: '.shipfox/workflows/test.yml',
        yaml: `
name: Agent Workflow
runner: ubuntu-latest
jobs:
  build:
    steps:
      - prompt: Fix the issue
        integrations:
          - include: [issue_read]
`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(getAgentToolsContext).toHaveBeenCalledWith({
      workspaceId,
      defaultConnectionId: sourceConnectionId,
    });
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

  test('valid YAML with invalid definition returns 400 with error code', async () => {
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
    expect(res.json().code).toBe('invalid-workflow-definition');
  });

  test('trigger-scoped validation errors remain client errors on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {
        project_id: projectId,
        config_path: 'test.yml',
        yaml: `
name: Broken trigger
runner: ubuntu-latest
triggers:
  nightly:
    source: cron
    event: tick
    config:
      schedule: "not a cron"
jobs:
  build:
    steps:
      - run: echo hello
`,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid-workflow-definition',
      details: [
        {
          message: 'Cron trigger schedule must be a valid 5-field cron expression.',
          path: 'triggers.nightly.config.schedule',
        },
      ],
    });
  });

  test('cyclic DAG returns 400 with dag error code', async () => {
    const cyclicYaml = `
name: Cyclic
runner: ubuntu-latest
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
    expect(res.json().code).toBe('invalid-workflow-definition');
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
runner: ubuntu-latest
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

  test('runner-less YAML returns validation details with the runner path', async () => {
    const yaml = `
name: Missing Runner
jobs:
  build:
    steps:
      - run: echo hello
`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/definitions',
      payload: {project_id: projectId, config_path: 'test.yml', yaml},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      code: 'invalid-workflow-definition',
      details: [expect.objectContaining({path: 'jobs.build.runner'})],
    });
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
    expect(res.json().message).toBeDefined();
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
