import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {workflowRuns} from '#db/schema/workflow-runs.js';
import {createWorkflowRun, updateWorkflowRunStatus} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {listRunsRoute} from './list-runs.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const projects = {
  getProjectById: vi.fn(({projectId}) =>
    Promise.resolve({
      project: {
        id: projectId,
        workspaceId: projectAccessState.workspaceId,
        sourceConnectionId: crypto.randomUUID(),
        sourceExternalRepositoryId: 'repo',
        name: 'Project',
      },
    }),
  ),
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('GET /api/workflows/runs', () => {
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
    app.get('/api/workflows/runs', listRunsRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
  });

  test('returns runs for a project', async () => {
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Test',
      model: workflowModel({name: 'Test'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Test 2',
      model: workflowModel({name: 'Test 2'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].project_id).toBe(projectId);
    expect(body.runs[0].name).toBeDefined();
    expect(body.runs[0].workflow_name).toBeDefined();
    expect(body.runs[0].trigger_source).toBe('manual');
    // The runs list carries run-level timing (null until the run starts).
    expect(body.runs[0]).toMatchObject({
      started_at: null,
      finished_at: null,
      has_started_job_execution: false,
    });
    expect(body.next_cursor).toBeNull();
    expect(body.filtered_total_count).toBe(2);
  });

  test('carries the current attempt jobs in graph order so a row can draw its status strip', async () => {
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Pipeline',
      model: workflowModel({
        name: 'Pipeline',
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
          deploy: {needs: 'test', steps: [{run: 'echo deploy'}]},
        },
      }),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    const [run] = res.json().runs;
    expect(run.jobs.map((job: {key: string}) => job.key)).toEqual(['build', 'test', 'deploy']);
    expect(run.jobs[0]).toMatchObject({status: 'pending', position: 0});
  });

  test('reports a null trigger reference for a run no source-control event produced', async () => {
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Manual',
      model: workflowModel({name: 'Manual'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.json().runs[0].trigger_reference).toBeNull();
  });

  test('labels runs with the synced origin and no dev source by default', async () => {
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Manual',
      model: workflowModel({name: 'Manual'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs[0]).toMatchObject({origin: 'synced', dev_source: null});
  });

  test('filters runs by origin', async () => {
    const synced = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Synced',
      model: workflowModel({name: 'Synced'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const devRun = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Dev',
      model: workflowModel({name: 'Dev'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    const initiatedByUserId = crypto.randomUUID();
    await db()
      .update(workflowRuns)
      .set({
        origin: 'dev',
        devSource: {
          ref: 'fix-triage-prompt',
          commit: 'abc123',
          configPath: '.shipfox/workflows/triage-sentry.yml',
          initiatedByUserId,
          replayOfEventId: null,
        },
      })
      .where(eq(workflowRuns.id, devRun.id));

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&origin=dev`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs.map((run: {id: string}) => run.id)).toEqual([devRun.id]);
    expect(body.filtered_total_count).toBe(1);
    expect(body.runs[0]).toMatchObject({
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abc123',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: initiatedByUserId,
        replay_of_event_id: null,
      },
    });
    expect(synced.id).not.toBe(devRun.id);
  });

  test('returns empty array for project with no runs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().runs).toEqual([]);
    expect(res.json().next_cursor).toBeNull();
    expect(res.json().filtered_total_count).toBe(0);
  });

  test('filters runs and returns filtered total count', async () => {
    const succeeded = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Deploy',
      model: workflowModel({name: 'Deploy'}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    await updateWorkflowRunStatus({
      workflowRunId: succeeded.id,
      status: 'succeeded',
      expectedVersion: succeeded.version,
    });
    await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      name: 'Nightly',
      model: workflowModel({name: 'Nightly'}),
      triggerPayload: {source: 'cron', event: 'tick', scheduleId: 'nightly'},
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&status=succeeded&trigger_source=manual`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe(succeeded.id);
    expect(body.filtered_total_count).toBe(1);
  });

  test('paginates with created_at and id cursor', async () => {
    const first = await createRunAt({
      workspaceId,
      projectId,
      name: 'First',
      createdAt: new Date('2026-05-07T00:00:00.000Z'),
    });
    const second = await createRunAt({
      workspaceId,
      projectId,
      name: 'Second',
      createdAt: new Date('2026-05-07T01:00:00.000Z'),
    });
    await createRunAt({
      workspaceId,
      projectId,
      name: 'Other',
      createdAt: new Date('2026-05-07T02:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&limit=2`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs.map((run: {name: string}) => run.name)).toEqual(['Other', 'Second']);
    expect(body.next_cursor).toBe(
      encodeTimestampIdCursor({createdAt: second.createdAt, id: second.id}),
    );

    const next = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&limit=2&cursor=${body.next_cursor}`,
    });

    expect(next.statusCode).toBe(200);
    expect(next.json().runs.map((run: {id: string}) => run.id)).toEqual([first.id]);
  });

  test('invalid cursor returns stable client error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&cursor=not-a-cursor`,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-cursor');
  });

  test('invalid date window returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs?project_id=${projectId}&created_from=2026-05-08T00:00:00.000Z&created_to=2026-05-07T00:00:00.000Z`,
    });

    expect(res.statusCode).toBe(400);
  });
});

async function createRunAt({
  workspaceId,
  projectId,
  name,
  createdAt,
}: {
  workspaceId: string;
  projectId: string;
  name: string;
  createdAt: Date;
}) {
  const run = await createWorkflowRun({
    workspaceId,
    projectId,
    definitionId: crypto.randomUUID(),
    name,
    model: workflowModel({name}),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });

  await db()
    .update(workflowRuns)
    .set({createdAt, updatedAt: createdAt})
    .where(eq(workflowRuns.id, run.id));

  return {...run, createdAt, updatedAt: createdAt};
}
