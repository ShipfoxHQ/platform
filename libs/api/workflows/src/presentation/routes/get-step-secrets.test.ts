import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createCapturingLogger} from '@shipfox/node-log/test';
import {agentThinkingSchema} from '@shipfox/workflow-document';
import {eq} from 'drizzle-orm';
import type {StepStatus} from '#core/entities/step.js';
import {db} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  createWorkflowRun,
  getJobScope,
  getJobsByWorkflowRunId,
  getStepsByJobId,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/factories/workflow-model.js';
import {mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {agentTestClient} from '#test/fixtures/agent-inter-module.js';
import {annotationsTestClient} from '#test/fixtures/annotations-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {fakeLeaseTokenAuthMethod} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

const URL_PREFIX = '/runs/jobs/current/steps';

describe('GET /runs/jobs/current/steps/:stepId/secrets', () => {
  let app: FastifyInstance;
  const secrets = createTestSecretsClient();
  const {logger, lines: logLines, clear: clearLogLines} = createCapturingLogger();

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: agentTestClient,
          annotations: annotationsTestClient,
          auth: workflowsTestAuthClient,
          integrations: {} as never,
          projects: projectsTestClient,
          runners: runnersTestClient,
          secrets,
        }),
      ],
      swagger: false,
      fastifyOptions: {loggerInstance: logger},
    });
    await app.ready();
  });

  beforeEach(() => {
    clearLogLines();
  });

  afterAll(async () => {
    await closeApp();
  });

  test('returns only referenced secrets for the leased run step and does not cache or log plaintext', async () => {
    const {run, job, step} = await createRunningRunStep();
    await setRunSecretBindings(step.id, [
      {
        target: 'TOKEN',
        segments: [
          {kind: 'literal', value: 'prefix-'},
          {kind: 'secret', store: 'local', key: 'API_TOKEN'},
        ],
      },
      {
        target: 'REUSED',
        segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
      },
    ]);
    await secrets.setSecrets({
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      values: {API_TOKEN: 'runtime-secret', UNUSED_TOKEN: 'unused-secret'},
    });
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      secrets: [{store: 'local', key: 'API_TOKEN', value: 'runtime-secret'}],
    });
    expect(res.body).not.toContain('unused-secret');
    expect(logLines.join('\n')).not.toContain('runtime-secret');
  });

  test('derives scope from the job row and prefers project secrets over workspace secrets', async () => {
    const {run, job, step} = await createRunningRunStep();
    const hostileWorkspaceId = crypto.randomUUID();
    await setRunSecretBindings(step.id, [
      {
        target: 'TOKEN',
        segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
      },
    ]);
    await secrets.setSecrets({
      workspaceId: run.workspaceId,
      values: {API_TOKEN: 'workspace-secret'},
    });
    await secrets.setSecrets({
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      values: {API_TOKEN: 'project-secret'},
    });
    await secrets.setSecrets({
      workspaceId: hostileWorkspaceId,
      values: {API_TOKEN: 'hostile-secret'},
    });
    const token = await mintActiveLeaseToken({
      jobId: job.id,
      token: {workspaceId: hostileWorkspaceId, projectId: crypto.randomUUID()},
    });

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secrets).toEqual([
      {store: 'local', key: 'API_TOKEN', value: 'project-secret'},
    ]);
    expect(res.body).not.toContain('hostile-secret');
  });

  test('returns an empty response without resolving secrets when bindings are absent', async () => {
    const {job, step} = await createRunningRunStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({secrets: []});
  });

  test('returns 409 when the leased step is not a run step', async () => {
    const {job, step} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-run');
  });

  test('returns 422 when a referenced secret does not exist', async () => {
    const {job, step} = await createRunningRunStep();
    await setRunSecretBindings(step.id, [
      {
        target: 'TOKEN',
        segments: [{kind: 'secret', store: 'local', key: 'MISSING_TOKEN'}],
      },
    ]);
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('secret-not-found');
  });

  test('returns 409 instead of 500 when stored secret bindings are corrupt', async () => {
    const {job, step} = await createRunningRunStep();
    await db()
      .update(stepsTable)
      .set({config: {run: 'echo "$TOKEN"', secret_bindings: [{target: 'TOKEN'}]}})
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: stepSecretsUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('secret-bindings-invalid');
  });

  test('getJobScope returns the workspace and project that own a job', async () => {
    const {run, job} = await createRunningRunStep();

    const scope = await getJobScope(job.id);

    expect(scope).toEqual({
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      triggerReference: null,
    });
  });
});

function stepSecretsUrl(stepId: string, attempt: number): string {
  const search = new URLSearchParams({attempt: String(attempt)});
  return `${URL_PREFIX}/${stepId}/secrets?${search.toString()}`;
}

async function setRunSecretBindings(
  stepId: string,
  bindings: NonNullable<Record<string, unknown>['secret_bindings']>,
): Promise<void> {
  await db()
    .update(stepsTable)
    .set({config: {run: 'echo "$TOKEN"', secret_bindings: bindings}})
    .where(eq(stepsTable.id, stepId));
}

type TestStepInput = {prompt: string} | {run: string};

async function createRunningRunStep(options: {status?: StepStatus} = {}) {
  return await createStep({
    steps: [{run: 'echo hello'}],
    targetType: 'run',
    status: options.status ?? 'running',
  });
}

async function createRunningAgentStep() {
  return await createStep({
    steps: [{prompt: 'Fix the failing tests.'}],
    targetType: 'agent',
    status: 'running',
  });
}

async function createStep(params: {
  steps: readonly TestStepInput[];
  targetType: 'agent' | 'run';
  status: StepStatus;
}) {
  const run = await createWorkflowRun({
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps: params.steps}}}),
    resolveAgentDefaults: (defaults) => ({
      harness: defaults.harness ?? 'pi',
      provider: defaults.provider ?? 'anthropic',
      model: defaults.model ?? 'claude-opus-4-8',
      thinking: agentThinkingSchema.safeParse(defaults.thinking).data ?? 'high',
    }),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('createStep: run created no job');
  await db().update(jobs).set({status: 'running'}).where(eq(jobs.id, job.id));

  const stepRows = await getStepsByJobId(job.id);
  const step = stepRows.find((candidate) => candidate.type === params.targetType);
  if (!step) throw new Error(`createStep: ${params.targetType} step not found`);
  await db().update(stepsTable).set({status: params.status}).where(eq(stepsTable.id, step.id));

  return {
    run,
    job: {...job, status: 'running' as const},
    step: {...step, status: params.status},
  };
}
