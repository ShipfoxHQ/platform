import {closeApp, createApp} from '@shipfox/node-fastify';
import {sql} from 'drizzle-orm';
import {db, getProjectById} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projectsE2eRoutes} from './index.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const E2E_SOURCE_RE = /^e2e:/u;
const GENERATED_PROJECT_SLUG_RE = /^e2e-project-/u;

describe('projects E2E routes', () => {
  afterEach(async () => {
    await closeApp();
  });

  test('creates a project with generated synthetic source values', async () => {
    const workspaceId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: workspaceId,
        name: '  E2E Project  ',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workspace_id: workspaceId,
      name: 'E2E Project',
    });
    expect(res.json().source.connection_id).toMatch(UUID_RE);
    expect(res.json().source.external_repository_id).toMatch(E2E_SOURCE_RE);
  });

  test('generates distinct slugs for repeated names in one workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const first = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {workspace_id: workspaceId, name: 'E2E Project'},
    });
    const second = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {workspace_id: workspaceId, name: 'E2E Project'},
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().slug).toMatch(GENERATED_PROJECT_SLUG_RE);
    expect(second.json().slug).toMatch(GENERATED_PROJECT_SLUG_RE);
    expect(second.json().slug).not.toBe(first.json().slug);
  });

  test('preserves explicit synthetic source values', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: workspaceId,
        name: 'E2E Project',
        source_connection_id: sourceConnectionId,
        source_external_repository_id: 'e2e:explicit',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().source).toEqual({
      connection_id: sourceConnectionId,
      external_repository_id: 'e2e:explicit',
    });
  });

  test('preserves explicit source metadata for provider-backed fixtures', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: workspaceId,
        name: 'GitHub E2E Project',
        source_connection_id: sourceConnectionId,
        source_external_repository_id: 'github:42',
        source_repository_owner: 'shipfox',
        source_repository_name: 'e2e',
        source_default_branch: 'main',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      source: {
        connection_id: sourceConnectionId,
        external_repository_id: 'github:42',
      },
    });
    await expect(getProjectById(res.json().id)).resolves.toMatchObject({
      sourceRepositoryOwner: 'shipfox',
      sourceRepositoryName: 'e2e',
      sourceDefaultBranch: 'main',
    });
  });

  test('requires source repository owner and name together', async () => {
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: crypto.randomUUID(),
        name: 'GitHub E2E Project',
        source_repository_owner: 'shipfox',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test('returns conflict for duplicate explicit source values', async () => {
    const workspaceId = crypto.randomUUID();
    const sourceConnectionId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});
    const payload = {
      workspace_id: workspaceId,
      name: 'E2E Project',
      source_connection_id: sourceConnectionId,
      source_external_repository_id: 'e2e:duplicate',
    };
    await app.inject({method: 'POST', url: '/projects', payload});

    const res = await app.inject({method: 'POST', url: '/projects', payload});

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'project-already-exists',
      details: {
        source_connection_id: sourceConnectionId,
        source_external_repository_id: 'e2e:duplicate',
      },
    });
  });

  test('rejects invalid bodies', async () => {
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: 'not-a-uuid',
        name: 'E2E Project',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  test('does not write project outbox events', async () => {
    const workspaceId = crypto.randomUUID();
    const app = await createApp({routes: [projectsE2eRoutes], swagger: false});

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      payload: {
        workspace_id: workspaceId,
        name: 'E2E Project',
      },
    });

    const events = await db()
      .select()
      .from(projectsOutbox)
      .where(sql`${projectsOutbox.payload}->>'projectId' = ${res.json().id}`);
    expect(res.statusCode).toBe(201);
    expect(events).toEqual([]);
  });
});
