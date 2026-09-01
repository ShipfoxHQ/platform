import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {buildValidateDefinitionRoute} from './validate-definition.js';

describe('POST /definitions/validate', () => {
  let app: FastifyInstance;
  let projectId = crypto.randomUUID();
  let workspaceId = crypto.randomUUID();
  let sourceConnectionId = crypto.randomUUID();
  const getProjectById = vi.fn();
  const getValidationCatalogV2 = vi.fn(() => agentValidationCatalog);
  const getAgentToolsContext = vi.fn();

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
      '/definitions/validate',
      buildValidateDefinitionRoute({
        agent: {getValidationCatalogV2} as never,
        projects: {getProjectById} as Pick<ProjectsModuleClient, 'getProjectById'> as never,
        integrations: {
          getAgentToolsContext,
        } as Pick<IntegrationsModuleClient, 'getAgentToolsContext'> as IntegrationsModuleClient,
      }),
    );
    await app.ready();
  });

  beforeEach(() => {
    projectId = crypto.randomUUID();
    workspaceId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    getProjectById.mockResolvedValue({project: {id: projectId, workspaceId, sourceConnectionId}});
    getAgentToolsContext.mockClear();
    getAgentToolsContext.mockResolvedValue({
      selectionCatalogs: [],
      catalogs: [{provider: 'github', tools: []}],
      workspaceConnections: [
        {
          id: sourceConnectionId,
          slug: 'github-main',
          provider: 'github',
          capabilities: ['agent_tools'],
        },
      ],
      eventCatalogs: [],
      fixedEventProviders: [],
      defaultConnection: {
        id: sourceConnectionId,
        slug: 'github-main',
        provider: 'github',
      },
    });
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
    expect(getValidationCatalogV2).toHaveBeenCalledWith({workspaceId: null});
  });

  test('uses the project workspace default when project context is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {
        project_id: projectId,
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
    expect(getProjectById).toHaveBeenCalledWith({projectId});
    expect(getValidationCatalogV2).toHaveBeenCalledWith({workspaceId});
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

  test('loads integration context when validating a tool step', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {
        project_id: projectId,
        yaml: `
name: Tool workflow
runner: ubuntu-latest
jobs:
  inspect:
    steps:
      - tool: missing_tool
`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(getAgentToolsContext).toHaveBeenCalledWith({
      workspaceId,
      defaultConnectionId: sourceConnectionId,
    });
    expect(res.json()).toEqual({
      valid: false,
      errors: [
        {
          path: 'jobs.inspect.steps.0.tool',
          message: 'Unknown integration tool: missing_tool.',
        },
      ],
    });
  });

  test('requires project context when validating a tool step', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/definitions/validate',
      payload: {
        yaml: `
name: Tool workflow
runner: ubuntu-latest
jobs:
  inspect:
    steps:
      - tool: missing_tool
`,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(getAgentToolsContext).not.toHaveBeenCalled();
    expect(res.json()).toEqual({
      valid: false,
      errors: [
        {
          path: 'project_id',
          message:
            '`project_id` is required to validate integration triggers, listeners, agent integrations, and tool steps.',
        },
      ],
    });
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
