import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH,
  WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT,
  WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
  workflowRunOverviewResponseSchema,
  workflowRunSourceResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError} from '@shipfox/node-fastify';
import {eq, inArray} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {workflowRuns} from '#db/schema/workflow-runs.js';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {buildModel} from '#test/helpers/workflow-runs.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {getRunOverviewRoute} from './get-run-overview.js';
import {getRunSourceRoute} from './get-run-source.js';
import {listRunJobsRoute} from './list-run-jobs.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('bounded workflow run overview routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

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
    app.get('/api/workflows/runs/:id/overview', getRunOverviewRoute(projects));
    app.get('/api/workflows/runs/:id/source', getRunSourceRoute(projects));
    app.get('/api/workflows/runs/:id/jobs', listRunJobsRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    getProjectById.mockImplementation(({projectId: requestedProjectId}) =>
      Promise.resolve({
        project: {
          id: requestedProjectId,
          workspaceId,
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `repo:${crypto.randomUUID()}`,
          name: 'Project',
        },
      }),
    );
  });

  test('returns a schema-valid complete overview without heavy run fields', async () => {
    const run = await createRun(
      buildModel({
        name: 'Overview',
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
        },
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/overview?attempt=1`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowRunOverviewResponseSchema.safeParse(body).success).toBe(true);
    expect(body.run).toMatchObject({id: run.id, name: 'Overview', project_id: projectId});
    expect(body.attempt).toMatchObject({workflow_run_id: run.id, attempt: 1});
    expect(body.jobs).toMatchObject({kind: 'complete', total: 2});
    expect(body.jobs.items).toHaveLength(2);
    expect(body.jobs.items[1].dependencies).toEqual(['build']);
    expect(body).not.toHaveProperty('trigger_payload');
    expect(body).not.toHaveProperty('inputs');
    expect(body).not.toHaveProperty('source_snapshot');
    expect(body.jobs.items[0]).not.toHaveProperty('outputs');
    expect(body.jobs.items[0]).not.toHaveProperty('runner');
    expect(body.jobs.items[0].default_execution).not.toHaveProperty('trigger_events');
  });

  test('loads a source snapshot on demand and classifies legacy snapshots', async () => {
    const sourceRun = await createRun(buildModel(), {
      sourceSnapshot: {
        content: 'name: source\njobs:\n  build:\n    steps:\n      - run: echo source\n',
        format: 'yaml',
      },
    });
    const source = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${sourceRun.id}/source`,
    });

    expect(source.statusCode).toBe(200);
    expect(workflowRunSourceResponseSchema.safeParse(source.json()).success).toBe(true);
    expect(source.json()).toMatchObject({
      kind: 'available',
      workflow_run_id: sourceRun.id,
      workflow_run_attempt: 1,
      source_snapshot: {format: 'yaml'},
    });

    const preSnapshotRun = await createRun();
    const preSnapshot = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${preSnapshotRun.id}/source`,
    });
    expect(preSnapshot.statusCode).toBe(200);
    expect(preSnapshot.json()).toMatchObject({
      kind: 'unavailable',
      reason: 'pre_snapshot_run',
    });

    const temporaryRun = await createRun(buildModel(), {
      origin: 'dev',
      devSource: {
        ref: 'main',
        commit: 'abc123',
        configPath: '.shipfox/workflow.yml',
        initiatedByUserId: crypto.randomUUID(),
        replayOfEventId: null,
      },
    });
    const temporary = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${temporaryRun.id}/source`,
    });
    expect(temporary.statusCode).toBe(200);
    expect(temporary.json()).toMatchObject({
      kind: 'unavailable',
      reason: 'temporary_run',
    });

    await db()
      .update(workflowRuns)
      .set({
        sourceSnapshot: {
          content: 'x'.repeat(WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES + 1),
          format: 'yaml',
        },
      })
      .where(eq(workflowRuns.id, preSnapshotRun.id));
    const legacy = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${preSnapshotRun.id}/source`,
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toMatchObject({
      kind: 'unavailable',
      reason: 'legacy_snapshot_too_large',
    });
  });

  test('requires the selected attempt and keeps missing attempts as not found', async () => {
    const run = await createRun();

    const missingAttempt = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/overview?attempt=2`,
    });
    const missingQuery = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/overview`,
    });

    expect(missingAttempt.statusCode).toBe(404);
    expect(missingAttempt.json().code).toBe('not-found');
    expect(missingQuery.statusCode).toBe(400);
  });

  test('paginates compact job summaries and rejects malformed cursors', async () => {
    const run = await createRun(
      buildModel({
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {steps: [{run: 'echo test'}]},
        },
      }),
    );

    const first = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/jobs?attempt=1&limit=1`,
    });
    const malformed = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/jobs?attempt=1&cursor=not-a-cursor`,
    });

    expect(first.statusCode).toBe(200);
    expect(first.json().items).toHaveLength(1);
    expect(first.json().total).toBe(2);
    expect(first.json().items[0]).not.toHaveProperty('dependencies');
    expect(first.json().next_cursor).toEqual(expect.any(String));

    const second = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/jobs?attempt=1&limit=1&cursor=${first.json().next_cursor}`,
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().items).toHaveLength(1);
    expect(second.json()).not.toHaveProperty('total');
    expect(second.json().next_cursor).toBeNull();
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().code).toBe('invalid-cursor');
  });

  test.each([
    ['an invalid job id', '0', 'not-a-uuid'],
    ['an empty position', '', crypto.randomUUID()],
    ['a position above PostgreSQL int4', '2147483648', crypto.randomUUID()],
  ] as const)('rejects cursors with %s', async (_description, value, id) => {
    const run = await createRun();
    const cursor = encodeCursorForTest({value, id});

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/jobs?attempt=1&cursor=${cursor}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid-cursor');
  });

  test('rejects an attempt above the PostgreSQL int4 range', async () => {
    const run = await createRun();

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/overview?attempt=2147483648`,
    });

    expect(response.statusCode).toBe(400);
  });

  test.each([
    403, 404,
  ] as const)('masks project access status %i for all run read endpoints', async (status) => {
    const run = await createRun();
    workspaceId = run.workspaceId;
    const error = new ClientError(
      'Project access denied',
      status === 403 ? 'forbidden' : 'not-found',
      {
        status,
      },
    );

    getProjectById.mockRejectedValueOnce(error);
    const overview = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/overview?attempt=1`,
    });
    getProjectById.mockRejectedValueOnce(error);
    const jobs = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/jobs?attempt=1`,
    });
    getProjectById.mockRejectedValueOnce(error);
    const source = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${run.id}/source`,
    });

    expect(overview.statusCode).toBe(404);
    expect(overview.json().code).toBe('not-found');
    expect(jobs.statusCode).toBe(404);
    expect(jobs.json().code).toBe('not-found');
    expect(source.statusCode).toBe(404);
    expect(source.json().code).toBe('not-found');
  });

  test('bounds the byte-limit fallback page before sending it', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 100,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    workspaceId = fixture.run.workspaceId;
    const statusReasonMessage = 'x'.repeat(JOB_EXECUTION_STATUS_REASON_MESSAGE_MAX_LENGTH);
    await db()
      .update(jobExecutions)
      .set({statusReasonMessage})
      .where(inArray(jobExecutions.id, fixture.executionIds));

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/overview?attempt=1`,
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThanOrEqual(
      WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT,
    );
    expect(workflowRunOverviewResponseSchema.safeParse(body).success).toBe(true);
    expect(body.jobs.kind).toBe('large');
    expect(body.jobs.first_page.items.length).toBeLessThan(100);
    expect(body.jobs.first_page.next_cursor).toEqual(expect.any(String));
  });

  test('uses the large-workflow variant and continues after its embedded page', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 101,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    workspaceId = fixture.run.workspaceId;

    const overview = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/overview?attempt=1`,
    });

    expect(overview.statusCode).toBe(200);
    expect(overview.json().jobs).toMatchObject({kind: 'large', total: 101});
    expect(overview.json().jobs.first_page.items).toHaveLength(100);
    expect(overview.json().jobs.first_page.next_cursor).toEqual(expect.any(String));

    const continuation = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/${fixture.run.id}/jobs?attempt=1&limit=100&cursor=${overview.json().jobs.first_page.next_cursor}`,
    });

    expect(continuation.statusCode).toBe(200);
    expect(continuation.json().items).toHaveLength(1);
    expect(continuation.json().items[0].position).toBe(100);
    expect(continuation.json()).not.toHaveProperty('total');
  });

  function createRun(
    model = buildModel(),
    options: Pick<
      Parameters<typeof createWorkflowRun>[0],
      'sourceSnapshot' | 'origin' | 'devSource'
    > = {},
  ) {
    return createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model,
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
      ...options,
    });
  }
});

function encodeCursorForTest(payload: {value: string; id: string}): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
