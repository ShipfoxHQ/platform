import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {
  SECRET_CREATED,
  SECRET_DELETED,
  SECRET_UPDATED,
  VARIABLE_CREATED,
  VARIABLE_DELETED,
} from '@shipfox/api-secrets-dto';
import {createInterModuleKnownError, defineInterModulePresentation} from '@shipfox/inter-module';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {setSecrets} from '#core/index.js';
import {db, secretsOutbox, secretValues, secretVariables} from '#db/index.js';
import {createSecretsRoutes} from './index.js';

const requireProjectForWorkspace = vi.fn();
const projects = createFakeInterModuleClients({
  projects: defineInterModulePresentation(projectsInterModuleContract, {
    getProjectById: () => ({project: null}),
    getProjectBySource: () => ({project: null}),
    findProjectBySourceRepositoryName: () => ({projects: []}),
    listProjectsByWorkspace: () => ({projects: [], nextCursor: null}),
    getWorkspaceProjectCounts: () => ({counts: []}),
    requireProjectForWorkspace: async (input) => await requireProjectForWorkspace(input),
    resolveCheckoutTarget: () => ({
      projectId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'repo',
    }),
  }),
}).projects;

const USER_ID = '11111111-1111-4111-8111-111111111111';
let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: USER_ID,
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

describe('secrets management routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let workspaceId: string;
  let projectId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
    requireProjectForWorkspace.mockResolvedValue({
      project: {
        id: projectId,
        workspaceId,
        name: 'Project',
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'repo-1',
        createdAt: new Date(),
      },
    });
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createSecretsRoutes(projects),
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await db().delete(secretValues).where(eq(secretValues.workspaceId, workspaceId));
    await db().delete(secretVariables).where(eq(secretVariables.workspaceId, workspaceId));
    await closeApp();
  });

  it('registers management routes under user auth', () => {
    expect(createSecretsRoutes(projects)[0]?.auth).toBe(AUTH_USER);
  });

  it('returns 401 unauthenticated and 403 for non-members', async () => {
    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets`,
    });
    authenticatedMemberships = [];

    const forbidden = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets`,
      headers: {authorization: 'Bearer user'},
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(forbidden.statusCode).toBe(403);
  });

  it('requires admin membership for writes', async () => {
    authenticatedMemberships = [
      {
        workspaceId,
        role: 'viewer' as UserContextMembership['role'],
        workspaceStatus: 'active',
      },
    ];

    const res = await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'sk-live-secret'},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('forbidden');
  });

  it('creates secrets without exposing plaintext or fingerprints', async () => {
    const secretValue = 'sk-live-secret-value';

    const res = await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: secretValue},
    });
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));

    expect(res.statusCode).toBe(200);
    expect(res.json().secret).toMatchObject({
      key: 'API_TOKEN',
      project_id: null,
      last_edited_by: USER_ID,
    });
    expect(res.body).not.toContain(secretValue);
    expect(res.body).not.toContain('fingerprint');
    expect(res.body).not.toContain(rows[0]?.fingerprint ?? 'missing-fingerprint');
  });

  it('keeps system-namespaced records invisible to management lists', async () => {
    await setSecrets({
      workspaceId,
      namespace: 'system/agent/model-provider/openai',
      values: {API_TOKEN: 'system-secret'},
    });
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'user-secret'},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secrets).toHaveLength(1);
    expect(res.json().secrets[0].key).toBe('API_TOKEN');
  });

  it('uses exact project scope for management lists', async () => {
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/REGION`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'workspace'},
    });
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/REGION`,
      headers: {authorization: 'Bearer user'},
      payload: {project_id: projectId, value: 'project'},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/variables?project_id=${projectId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().variables).toEqual([
      expect.objectContaining({key: 'REGION', project_id: projectId, value: 'project'}),
    ]);
  });

  it('returns readable variables and advisory warnings for sensitive names', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'not-secret-but-sensitive-name'},
    });

    const get = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/variables/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().warnings).toEqual([{code: 'sensitive-variable-name', key: 'API_TOKEN'}]);
    expect(get.statusCode).toBe(200);
    expect(get.json().variable.value).toBe('not-secret-but-sensitive-name');
  });

  it('returns a bounded single-line preview for variable list values', async () => {
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/MULTILINE`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'first line\nsecond line'},
    });
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/SHORT`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'debug'},
    });

    const list = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/variables?limit=10000`,
      headers: {authorization: 'Bearer user'},
    });
    const full = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/variables/MULTILINE`,
      headers: {authorization: 'Bearer user'},
    });

    const byKey = Object.fromEntries(
      (list.json().variables as Array<{key: string; value: string; value_truncated: boolean}>).map(
        (variable) => [variable.key, variable],
      ),
    );
    expect(byKey.MULTILINE).toMatchObject({value: 'first line', value_truncated: true});
    expect(byKey.SHORT).toMatchObject({value: 'debug', value_truncated: false});
    // The full value is still available through the single-item read used for editing.
    expect(full.json().variable.value).toBe('first line\nsecond line');
  });

  it('supports paginated secret lists', async () => {
    await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/secrets:batch`,
      headers: {authorization: 'Bearer user'},
      payload: {
        entries: [
          {key: 'ALPHA', value: 'alpha-value'},
          {key: 'BRAVO', value: 'bravo-value'},
        ],
      },
    });

    const first = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets?limit=1`,
      headers: {authorization: 'Bearer user'},
    });
    const second = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets?limit=1&cursor=${first.json().next_cursor}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().secrets.map((secret: {key: string}) => secret.key)).toEqual(['ALPHA']);
    expect(second.json().secrets.map((secret: {key: string}) => secret.key)).toEqual(['BRAVO']);
  });

  it('accepts a limit above 100 and returns the whole set in one call', async () => {
    await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/secrets:batch`,
      headers: {authorization: 'Bearer user'},
      payload: {
        entries: [
          {key: 'ALPHA', value: 'alpha-value'},
          {key: 'BRAVO', value: 'bravo-value'},
        ],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets?limit=10000`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secrets.map((secret: {key: string}) => secret.key)).toEqual([
      'ALPHA',
      'BRAVO',
    ]);
    expect(res.json().next_cursor).toBeNull();
  });

  it('rejects malformed management cursors', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/secrets?cursor=not-a-cursor`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });

  it('rejects duplicate batch keys without returning stale warnings', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/secrets:batch`,
      headers: {authorization: 'Bearer user'},
      payload: {
        entries: [
          {key: 'API_TOKEN', value: 'short'},
          {key: 'API_TOKEN', value: 'long-enough-secret'},
        ],
      },
    });
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));

    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('short-secret-value');
    expect(rows).toHaveLength(0);
  });

  it('emits per-key create and update events for batch writes', async () => {
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'first-secret'},
    });

    const res = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/secrets:batch`,
      headers: {authorization: 'Bearer user'},
      payload: {
        entries: [
          {key: 'API_TOKEN', value: 'updated-secret'},
          {key: 'NEW_TOKEN', value: 'new-secret'},
        ],
      },
    });
    const events = await outboxRowsForWorkspace(workspaceId);

    expect(res.statusCode).toBe(200);
    expect(events.map((event) => event.eventType)).toEqual([
      SECRET_CREATED,
      SECRET_UPDATED,
      SECRET_CREATED,
    ]);
    expect(events.at(-1)?.payload).toMatchObject({
      actorId: USER_ID,
      workspaceId,
      projectId: null,
      key: 'NEW_TOKEN',
    });
  });

  it('deletes variables with a 204 and emits no event for missing deletes', async () => {
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/variables/REGION`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'eu-west-1'},
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/variables/REGION`,
      headers: {authorization: 'Bearer user'},
    });
    const missing = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/variables/REGION`,
      headers: {authorization: 'Bearer user'},
    });
    const events = await outboxRowsForWorkspace(workspaceId);

    expect(deleted.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('variable-not-found');
    expect(events.map((event) => event.eventType)).toEqual([VARIABLE_CREATED, VARIABLE_DELETED]);
  });

  it('deletes secrets with a 204 and emits no event for missing deletes', async () => {
    await app.inject({
      method: 'PUT',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
      payload: {value: 'secret-value'},
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
    });
    const missing = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/secrets/API_TOKEN`,
      headers: {authorization: 'Bearer user'},
    });
    const rows = await db()
      .select()
      .from(secretValues)
      .where(eq(secretValues.workspaceId, workspaceId));
    const events = await outboxRowsForWorkspace(workspaceId);

    expect(deleted.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe('secret-not-found');
    expect(rows).toHaveLength(0);
    expect(events.map((event) => event.eventType)).toEqual([SECRET_CREATED, SECRET_DELETED]);
  });

  it('returns 404 when project_id does not belong to the workspace', async () => {
    requireProjectForWorkspace.mockRejectedValueOnce(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.requireProjectForWorkspace,
        'project-not-found',
        {projectId},
      ),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/variables?project_id=${projectId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('project-not-found');
  });
});

async function outboxRowsForWorkspace(workspaceId: string) {
  return await db()
    .select()
    .from(secretsOutbox)
    .where(
      and(
        sql`${secretsOutbox.payload}->>'workspaceId' = ${workspaceId}`,
        isNull(secretsOutbox.deadLetteredAt),
      ),
    )
    .orderBy(secretsOutbox.createdAt, secretsOutbox.id);
}
