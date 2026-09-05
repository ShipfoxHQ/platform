import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
} from '@shipfox/api-workflows-dto';
import {
  type WorkspacesInterModuleClient,
  workspacesInterModuleContract,
} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, errorHandler} from '@shipfox/node-fastify';
import type {DomainEvent} from '@shipfox/node-outbox';
import {eq} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import type {WorkflowAdmissionPolicy} from '#core/workspace-admission.js';
import {db} from '#db/db.js';
import {steps} from '#db/schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  getWorkflowRunById,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/workflow-runs.js';
import {createWorkflowsModule} from '#index.js';
import {listTestRunAttempts} from '#test/helpers/run-attempts.js';
import {runAttemptCreatedEvents} from '#test/helpers/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {rerunRunRoute} from './rerun-run.js';

const projectAccessState = vi.hoisted(() => ({workspaceId: ''}));

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;
const getWorkspaceOperatingState = vi.fn();
const workspaces = {getWorkspaceOperatingState} as unknown as WorkspacesInterModuleClient;
const admit = vi.fn<WorkflowAdmissionPolicy['admit']>();
const admission = {policy: {admit}};
const startMock = vi.hoisted(() => vi.fn());

vi.mock('@shipfox/node-temporal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/node-temporal')>()),
  temporalClient: () => ({workflow: {start: startMock}}),
}));

function registeredAttemptCreatedSubscriber(
  carryOverSessions: AgentInterModuleClient['carryOverSessions'],
) {
  const module = createWorkflowsModule({
    agent: {carryOverSessions} as AgentInterModuleClient,
    definitions: {} as never,
    annotations: {} as never,
    auth: {} as never,
    integrations: {} as never,
    logs: {} as never,
    projects: {} as never,
    runners: {} as never,
    secrets: {} as never,
    workspaces: {} as never,
  });
  const subscriber = module.subscribers?.find(
    (candidate) => candidate.event === WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  );
  if (!subscriber) throw new Error('Expected workflow run attempt-created subscriber');
  return subscriber.handler;
}

describe('POST /api/workflows/runs/:id/rerun', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;

  beforeAll(async () => {
    app = Fastify();
    app.setErrorHandler(errorHandler);
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
    app.post('/api/workflows/runs/:id/rerun', rerunRunRoute(projects, workspaces, admission));
    await app.ready();
  });

  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    projectAccessState.workspaceId = workspaceId;
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
    getWorkspaceOperatingState.mockResolvedValue({status: 'active'});
    admit.mockResolvedValue({allowed: true});
  });

  async function createTerminalRun(status: 'succeeded' | 'failed' = 'failed') {
    const run = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });
    return updateWorkflowRunStatus({workflowRunId: run.id, status, expectedVersion: run.version});
  }

  async function createFailedRunWithFailedJob() {
    const run = await createTerminalRun('failed');
    const [job] = await getJobsByWorkflowRunId(run.id);
    if (!job) throw new Error('Expected workflow job');
    await updateJobStatus({jobId: job.id, status: 'failed', expectedVersion: job.version});
    return run;
  }

  test('creates a new attempt for all mode', async () => {
    const source = await createTerminalRun('failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: source.id,
      current_attempt: 2,
      latest_attempt: 2,
      status: 'pending',
    });
  });

  test('creates a new attempt for failed mode and carries sessions between attempts', async () => {
    const source = await createFailedRunWithFailedJob();
    const [sourceAttempt] = await listTestRunAttempts({workflowRunId: source.id, projectId});
    if (!sourceAttempt) throw new Error('Expected source attempt');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'failed'},
    });

    const attempts = await listTestRunAttempts({workflowRunId: source.id, projectId});
    const targetAttempt = attempts.find((attempt) => attempt.attempt === 2);

    if (!targetAttempt) throw new Error('Expected target attempt');

    expect(targetAttempt.id).not.toBe(sourceAttempt.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: source.id,
      current_attempt: 2,
      latest_attempt: 2,
      status: 'pending',
    });
  });

  test('keeps a failed rerun pending when session carry-over fails', async () => {
    const source = await createFailedRunWithFailedJob();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'failed'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: source.id,
      current_attempt: 2,
      latest_attempt: 2,
      status: 'pending',
    });

    const sourceAttempt = (await listTestRunAttempts({workflowRunId: source.id, projectId})).find(
      (attempt) => attempt.attempt === 1,
    );
    if (!sourceAttempt) throw new Error('Expected source attempt');
    const event = (await runAttemptCreatedEvents(source.id)).find(
      (candidate) => candidate.attempt === 2,
    );
    if (!event) throw new Error('Expected attempt-created event');
    const carryOverSessions = vi
      .fn<AgentInterModuleClient['carryOverSessions']>()
      .mockRejectedValue(new Error('carry-over-conflict'));
    const subscriber = registeredAttemptCreatedSubscriber(carryOverSessions);
    const domainEvent: DomainEvent<typeof event> = {
      id: crypto.randomUUID(),
      type: WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
      createdAt: new Date(),
      payload: event,
    };

    await expect(subscriber(domainEvent)).rejects.toThrow('carry-over-conflict');

    expect(carryOverSessions).toHaveBeenCalledWith({
      fromWorkflowRunAttemptId: sourceAttempt.id,
      toWorkflowRunAttemptId: event.workflowRunAttemptId,
    });
    expect(startMock).not.toHaveBeenCalled();
    await expect(getWorkflowRunById(source.id)).resolves.toMatchObject({
      currentAttempt: 2,
      status: 'pending',
    });
  });

  test('does not carry sessions for an all-jobs rerun', async () => {
    const source = await createTerminalRun();

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(200);
  });

  test('does not reject a config that only exceeds the inline diagnostic limit', async () => {
    const source = await createTerminalRun('failed');
    const [job] = await getJobsByWorkflowRunId(source.id);
    if (!job) throw new Error('Expected workflow job');
    const [step] = await getStepsByJobId(job.id);
    if (!step) throw new Error('Expected workflow step');

    await db()
      .update(steps)
      .set({config: {run: 'x'.repeat(WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES)}})
      .where(eq(steps.id, step.id));

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({current_attempt: 2, status: 'pending'});
    await expect(getWorkflowRunById(source.id)).resolves.toMatchObject({
      currentAttempt: 2,
      status: 'pending',
      version: source.version + 1,
    });
  });

  test('returns 409 when failed mode has no failed or cancelled jobs', async () => {
    const source = await createTerminalRun('succeeded');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'failed'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('no-failed-jobs');
  });

  test('returns workspace-suspended before creating a new attempt', async () => {
    const source = await createTerminalRun('failed');
    getWorkspaceOperatingState.mockResolvedValueOnce({status: 'suspended'});

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('workspace-suspended');
    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
  });

  test('returns an admission denial with required action before creating a new attempt', async () => {
    const source = await createTerminalRun('failed');
    const requiredAction = {
      reason: 'billing-payment-method-required',
      message: 'Add a payment method to continue.',
      url: '/settings/billing',
    };
    admit.mockResolvedValue({allowed: false, reason: requiredAction.reason, requiredAction});

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'admission-denied',
      details: {
        workspace_id: source.workspaceId,
        reason: requiredAction.reason,
        required_action: requiredAction,
      },
    });
    expect(admit).toHaveBeenCalledWith({
      workspaceId: source.workspaceId,
      source: source.triggerSource,
      definitionId: source.definitionId,
    });
    await expect(getWorkflowRunById(source.id)).resolves.toMatchObject({currentAttempt: 1});
  });

  test('returns workspace-deleted before creating a new attempt', async () => {
    const source = await createTerminalRun('failed');
    getWorkspaceOperatingState.mockResolvedValueOnce({status: 'deleted'});

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('workspace-deleted');
  });

  test('returns workspace-not-found before creating a new attempt', async () => {
    const source = await createTerminalRun('failed');
    getWorkspaceOperatingState.mockRejectedValueOnce(
      createInterModuleKnownError(
        workspacesInterModuleContract.methods.getWorkspaceOperatingState,
        'workspace-not-found',
        {workspaceId},
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('workspace-not-found');
  });

  test('returns 409 when the source run is not terminal', async () => {
    const source = await createWorkflowRun({
      workspaceId,
      projectId,
      definitionId: crypto.randomUUID(),
      model: workflowModel(),
      triggerPayload: {
        source: 'manual',
        event: 'fire',
        subscriptionId: crypto.randomUUID(),
        userId: crypto.randomUUID(),
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('run-not-terminal');
  });

  test('returns 404 for a missing or inaccessible source run', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${crypto.randomUUID()}/rerun`,
      payload: {mode: 'all'},
    });
    const source = await createTerminalRun('failed');
    getProjectById.mockRejectedValueOnce(new ClientError('Forbidden', 'forbidden', {status: 403}));

    const inaccessible = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'all'},
    });

    expect(missing.statusCode).toBe(404);
    expect(inaccessible.statusCode).toBe(404);
  });

  test('returns 400 for an invalid mode', async () => {
    const source = await createTerminalRun('failed');

    const res = await app.inject({
      method: 'POST',
      url: `/api/workflows/runs/${source.id}/rerun`,
      payload: {mode: 'everything'},
    });

    expect(res.statusCode).toBe(400);
  });
});
