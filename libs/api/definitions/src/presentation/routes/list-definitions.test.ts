import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {encodeStringIdCursor} from '@shipfox/node-drizzle';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {markDefinitionSyncState} from '#db/index.js';
import {definitionFactory} from '#test/index.js';
import {buildListDefinitionsRoute} from './list-definitions.js';

const projectAccessState = vi.hoisted(() => ({
  workspaceId: '',
  sourceConnectionId: '',
  sourceExternalRepositoryId: '',
}));

const projects = {
  getProjectById: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {
        id: projectId,
        workspaceId: projectAccessState.workspaceId,
        sourceConnectionId: projectAccessState.sourceConnectionId,
        sourceExternalRepositoryId: projectAccessState.sourceExternalRepositoryId,
        name: 'Project',
      },
    }),
  ),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/definitions', () => {
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
    app.get('/api/definitions', buildListDefinitionsRoute(projects));
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
  });

  test('returns 200 with definitions list and sync summary', async () => {
    await definitionFactory.create({projectId, name: 'Bravo', configPath: 'b.yml'});
    await definitionFactory.create({projectId, name: 'Alpha', configPath: 'a.yml'});
    const startedAt = new Date('2026-05-07T01:00:00.000Z');
    const finishedAt = new Date('2026-05-07T01:00:05.000Z');
    await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId,
      ref: 'main',
      status: 'succeeded',
      startedAt,
      finishedAt,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.definitions).toHaveLength(2);
    expect(body.definitions[0].name).toBe('Alpha');
    expect(body.definitions[1].name).toBe('Bravo');
    expect(body.next_cursor).toBeNull();
    expect(body.sync).toEqual({
      ref: 'main',
      status: 'succeeded',
      last_sync_at: finishedAt.toISOString(),
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      last_error_code: null,
      last_error_message: null,
    });
  });

  test('returns 200 with empty array and null sync for project with no definitions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().definitions).toEqual([]);
    expect(res.json().sync).toBeNull();
    expect(res.json().next_cursor).toBeNull();
  });

  test('returns failed sync summary', async () => {
    const startedAt = new Date('2026-05-07T02:00:00.000Z');
    await markDefinitionSyncState({
      projectId,
      sourceConnectionId,
      sourceExternalRepositoryId,
      ref: 'main',
      status: 'failed',
      startedAt,
      lastErrorCode: 'no-workflow-files',
      lastErrorMessage: 'No workflow files found',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sync).toMatchObject({
      ref: 'main',
      status: 'failed',
      started_at: startedAt.toISOString(),
      finished_at: null,
      last_error_code: 'no-workflow-files',
      last_error_message: 'No workflow files found',
    });
  });

  test('invalid projectId UUID returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/definitions?project_id=not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
  });

  test('paginates alphabetically with name and id cursor', async () => {
    const bravo = await definitionFactory.create({projectId, name: 'Bravo', configPath: 'b.yml'});
    const charlie = await definitionFactory.create({
      projectId,
      name: 'Charlie',
      configPath: 'c.yml',
    });
    await definitionFactory.create({projectId, name: 'Alpha', configPath: 'a.yml'});

    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}&limit=2`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.definitions.map((definition: {name: string}) => definition.name)).toEqual([
      'Alpha',
      'Bravo',
    ]);
    expect(body.next_cursor).toBe(encodeStringIdCursor({value: bravo.name, id: bravo.id}));

    const next = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}&limit=2&cursor=${body.next_cursor}`,
    });
    expect(next.statusCode).toBe(200);
    expect(next.json().definitions.map((definition: {id: string}) => definition.id)).toEqual([
      charlie.id,
    ]);
  });

  test('invalid cursor returns stable client error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/definitions?project_id=${projectId}&cursor=not-a-cursor`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });
});
