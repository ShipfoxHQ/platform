import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {errorHandler} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {agentValidationCatalog} from '#test/agent-validation-catalog.js';
import {buildAtRefRoute} from './at-ref.js';

const COMMIT = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const CONFIG_PATH = '.shipfox/workflows/ci.yml';
const BROKEN_PATH = '.shipfox/workflows/broken.yml';

const validYaml = `
name: CI
runner: ubuntu-latest
triggers:
  on_demand:
    source: manual
    event: fire
jobs:
  build:
    steps:
      - run: pnpm test
`;

const invalidYaml = `
name: Bad YAML
jobs:
  build:
    steps:
      - run: echo hello
      invalid indentation here
`;

const warningYaml = `
name: Warning only
runner: ubuntu-latest
jobs:
  build:
    steps:
      - env:
          MSG: '${'$'.concat('{{ event.x }}')}'
        run: eval "$MSG"
`;

const projectAccessState = vi.hoisted(() => ({
  workspaceId: '',
  sourceConnectionId: '',
  sourceExternalRepositoryId: '',
}));

const projectsMocks = {
  getProjectById: vi.fn(),
  requireProjectForWorkspace: vi.fn(),
};
const projects = projectsMocks as unknown as ProjectsModuleClient;

const integrationsMocks = {
  resolveSourceRef: vi.fn(),
  listSourceFiles: vi.fn(),
  fetchSourceFile: vi.fn(),
};
const integrations = integrationsMocks as unknown as IntegrationsModuleClient;

const agentMocks = {
  getValidationCatalog: vi.fn(),
};
const agent = agentMocks as unknown as AgentInterModuleClient;

describe('GET /api/definitions/at-ref', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let sourceConnectionId: string;
  let sourceExternalRepositoryId: string;

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
    app.get('/api/definitions/at-ref', buildAtRefRoute({projects, agent, integrations}));
    app.setErrorHandler(errorHandler);
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    sourceConnectionId = crypto.randomUUID();
    sourceExternalRepositoryId = `repo:${crypto.randomUUID()}`;
    projectAccessState.workspaceId = workspaceId;
    projectAccessState.sourceConnectionId = sourceConnectionId;
    projectAccessState.sourceExternalRepositoryId = sourceExternalRepositoryId;
    vi.clearAllMocks();
    integrationsMocks.resolveSourceRef.mockResolvedValue({ref: 'fix-branch', commit: COMMIT});
    integrationsMocks.listSourceFiles.mockResolvedValue({
      files: [{path: CONFIG_PATH, type: 'file', size: validYaml.length}],
      nextCursor: null,
    });
    integrationsMocks.fetchSourceFile.mockResolvedValue({
      path: CONFIG_PATH,
      ref: COMMIT,
      content: validYaml,
    });
    agentMocks.getValidationCatalog.mockResolvedValue(agentValidationCatalog);
    projectsMocks.getProjectById.mockImplementation(({projectId}) =>
      Promise.resolve({
        project: {
          id: projectId,
          workspaceId: projectAccessState.workspaceId,
          sourceConnectionId: projectAccessState.sourceConnectionId,
          sourceExternalRepositoryId: projectAccessState.sourceExternalRepositoryId,
          name: 'Project',
        },
      }),
    );
  });

  test('returns 200 with the pinned commit and a valid file listing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ref: 'fix-branch',
      commit: COMMIT,
      files: [
        {
          config_path: CONFIG_PATH,
          name: 'CI',
          valid: true,
          errors: [],
          warnings: [],
          triggers: {on_demand: {source: 'manual', event: 'fire'}},
        },
      ],
    });
    expect(integrationsMocks.listSourceFiles).toHaveBeenCalledWith(
      expect.objectContaining({ref: COMMIT, prefix: '.shipfox/workflows/', limit: 100}),
      {signal: expect.any(AbortSignal)},
    );
    expect(projectsMocks.getProjectById).toHaveBeenCalledOnce();
  });

  test('returns 200 listing an invalid file with its errors instead of failing', async () => {
    integrationsMocks.listSourceFiles.mockResolvedValue({
      files: [
        {path: CONFIG_PATH, type: 'file', size: validYaml.length},
        {path: BROKEN_PATH, type: 'file', size: invalidYaml.length},
      ],
      nextCursor: null,
    });
    integrationsMocks.fetchSourceFile.mockImplementation(async ({path}) => ({
      path,
      ref: COMMIT,
      content: path === BROKEN_PATH ? invalidYaml : validYaml,
    }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(200);
    const files = res.json().files;
    expect(files).toHaveLength(2);
    expect(files.find((file: {config_path: string}) => file.config_path === CONFIG_PATH)).toEqual({
      config_path: CONFIG_PATH,
      name: 'CI',
      valid: true,
      errors: [],
      warnings: [],
      triggers: {on_demand: {source: 'manual', event: 'fire'}},
    });
    expect(
      files.find((file: {config_path: string}) => file.config_path === BROKEN_PATH),
    ).toMatchObject({
      config_path: BROKEN_PATH,
      name: null,
      valid: false,
      warnings: [],
      triggers: {},
    });
    expect(
      files.find((file: {config_path: string}) => file.config_path === BROKEN_PATH),
    ).toMatchObject({
      errors: [
        {
          message: expect.any(String),
          path: expect.any(String),
        },
      ],
    });
  });

  test('returns warning diagnostics for a valid workflow', async () => {
    integrationsMocks.fetchSourceFile.mockResolvedValue({
      path: CONFIG_PATH,
      ref: COMMIT,
      content: warningYaml,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].warnings).toEqual([
      expect.objectContaining({
        code: 're-evaluating-command',
        message: expect.stringContaining('re-executed as code'),
        path: 'jobs.build.steps.0.run',
      }),
    ]);
  });

  test('returns an empty listing when the ref has no workflow files', async () => {
    integrationsMocks.listSourceFiles.mockResolvedValue({
      files: [{path: '.shipfox/workflows/README.md', type: 'file', size: 8}],
      nextCursor: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ref: 'fix-branch', commit: COMMIT, files: []});
    expect(integrationsMocks.fetchSourceFile).not.toHaveBeenCalled();
  });

  test('returns 404 ref-not-found for a missing ref', async () => {
    integrationsMocks.resolveSourceRef.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRef,
        'ref-not-found',
        {ref: 'missing-branch'},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=missing-branch`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({code: 'ref-not-found', details: {ref: 'missing-branch'}});
  });

  test('returns 400 ref-invalid for a raw commit sha', async () => {
    integrationsMocks.resolveSourceRef.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRef,
        'ref-invalid',
        {ref: '9'.repeat(40)},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=${'9'.repeat(40)}`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({code: 'ref-invalid'});
  });

  test('returns 502 source-unavailable when the source repository cannot be reached', async () => {
    integrationsMocks.resolveSourceRef.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRef,
        'provider-failure',
        {reason: 'provider-unavailable'},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('source-unavailable');
  });

  test('returns 422 when the source connection is inactive', async () => {
    integrationsMocks.resolveSourceRef.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRef,
        'connection-inactive',
        {connectionId: sourceConnectionId},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('integration-connection-inactive');
  });

  test('returns 429 and retry details when the source provider rate-limits', async () => {
    integrationsMocks.resolveSourceRef.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRef,
        'provider-failure',
        {reason: 'rate-limited', retryAfterSeconds: 30},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({
      code: 'rate-limited',
      details: {retry_after_seconds: 30},
    });
  });

  test('returns 422 with the observed file count when the workflow limit is exceeded', async () => {
    integrationsMocks.listSourceFiles.mockResolvedValue({
      files: Array.from({length: 100}, (_, index) => ({
        path: `.shipfox/workflows/workflow-${index}.yml`,
        type: 'file',
        size: 1,
      })),
      nextCursor: 'more',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'too-many-files',
      details: {file_count: 100},
    });
  });

  test('returns 404 project-not-found for an unknown project', async () => {
    projectsMocks.getProjectById.mockResolvedValue({project: null});

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${crypto.randomUUID()}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project-not-found');
  });

  test('returns 403 forbidden for a project in a workspace the caller cannot access', async () => {
    projectAccessState.workspaceId = crypto.randomUUID();

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=fix-branch`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  test('returns 400 for a malformed project_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions/at-ref?project_id=not-a-uuid&ref=fix-branch',
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns 400 for a ref containing a control character', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions/at-ref?project_id=${projectId}&ref=main%0A`,
    });

    expect(res.statusCode).toBe(400);
    expect(projectsMocks.getProjectById).not.toHaveBeenCalled();
  });
});
