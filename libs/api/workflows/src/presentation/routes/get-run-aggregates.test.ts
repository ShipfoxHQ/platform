import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import {db} from '#db/db.js';
import {workflowRuns} from '#db/schema/workflow-runs.js';
import {createWorkflowRun, updateWorkflowRunStatus} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';

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

describe('GET /api/workflows/runs/aggregates', () => {
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
    app.get('/api/workflows/runs/aggregates', getRunAggregatesRoute(projects));
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
  });

  test('returns faceted counts that ignore only their own selected filter', async () => {
    const deployDefinitionId = crypto.randomUUID();
    const nightlyDefinitionId = crypto.randomUUID();
    const succeeded = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: deployDefinitionId,
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
      definitionId: deployDefinitionId,
      name: 'Deploy',
      model: workflowModel({name: 'Deploy'}),
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
      definitionId: nightlyDefinitionId,
      name: 'Nightly',
      model: workflowModel({name: 'Nightly'}),
      triggerPayload: {
        source: 'cron',
        event: 'tick',
        scheduleId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/aggregates?project_id=${projectId}&status=succeeded&trigger_source=manual`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toEqual(
      expect.arrayContaining([
        {value: 'pending', count: 1},
        {value: 'succeeded', count: 1},
      ]),
    );
    expect(body.trigger_source).toEqual([{value: 'manual', count: 1}]);
    expect(body.workflow).toEqual([{value: deployDefinitionId, count: 1}]);
  });

  test('filters faceted counts by origin so the Runs tab facet follows', async () => {
    await createWorkflowRun({
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
    await db()
      .update(workflowRuns)
      .set({
        origin: 'dev',
        devSource: {
          ref: 'fix-triage-prompt',
          commit: 'abc123',
          config_path: '.shipfox/workflows/triage-sentry.yml',
          initiated_by_user_id: crypto.randomUUID(),
          replay_of_event_id: null,
        },
      })
      .where(eq(workflowRuns.id, devRun.id));

    const res = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/aggregates?project_id=${projectId}&origin=dev`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toEqual([{value: 'pending', count: 1}]);
    expect(body.trigger_source).toEqual([{value: 'manual', count: 1}]);
    expect(body.workflow).toEqual([{value: devRun.definitionId, count: 1}]);
  });
});
