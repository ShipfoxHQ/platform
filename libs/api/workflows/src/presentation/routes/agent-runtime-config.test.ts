import {
  type AgentInterModuleClient,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createCapturingLogger} from '@shipfox/node-log/test';
import {eq} from 'drizzle-orm';
import type {StepStatus} from '#core/entities/step.js';
import {db, withTransaction} from '#db/db.js';
import {jobs} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  createWorkflowRun,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  insertRunningStepAttempt,
} from '#db/workflow-runs.js';
import {workflowModel} from '#test/factories/workflow-model.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {resolveTestAgentDefaults} from '#test/fixtures/agent-inter-module.js';
import {annotationsTestClient} from '#test/fixtures/annotations-inter-module.js';
import {workflowsTestAuthClient} from '#test/fixtures/auth-inter-module.js';
import {fakeLeaseTokenAuthMethod, mintLeaseToken} from '#test/fixtures/lease-token.js';
import {projectsTestClient} from '#test/fixtures/projects-inter-module.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createTestSecretsClient} from '#test/fixtures/secrets-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

const {captureExceptionMock} = vi.hoisted(() => ({captureExceptionMock: vi.fn()}));
vi.mock('@shipfox/node-error-monitoring', () => ({captureException: captureExceptionMock}));

const URL = '/runs/jobs/current/agent-runtime-config';
const secrets = createTestSecretsClient();
const runtimeConfigs = new Map<
  string,
  Awaited<ReturnType<AgentInterModuleClient['resolveRuntimeCredentials']>>
>();
const resolveRuntimeCredentials = vi.fn<AgentInterModuleClient['resolveRuntimeCredentials']>(
  ({workspaceId}) => {
    const runtimeConfig = runtimeConfigs.get(workspaceId);
    if (runtimeConfig) return Promise.resolve(runtimeConfig);
    return Promise.reject(
      createInterModuleKnownError(
        agentInterModuleContract.methods.resolveRuntimeCredentials,
        'model-provider-not-configured',
        {},
      ),
    );
  },
);
const agentTestClient: AgentInterModuleClient = {
  getValidationCatalog: vi.fn(),
  resolveAgentConfig: vi.fn(),
  resolveRuntimeCredentials,
  claimSession: vi.fn(),
  carryOverSessions: vi.fn(),
};

describe('GET /runs/jobs/current/agent-runtime-config', () => {
  let app: FastifyInstance;
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
    captureExceptionMock.mockReset();
    runtimeConfigs.clear();
    resolveRuntimeCredentials.mockClear();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('lease-token auth', () => {
    test('rejects a request without an Authorization header', async () => {
      const res = await app.inject({method: 'GET', url: runtimeConfigUrl(crypto.randomUUID(), 1)});

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('unauthorized');
    });
  });

  test('returns decrypted runtime credentials for a running leased agent step', async () => {
    const {run, job, step} = await createRunningAgentStep();
    await saveWorkspaceCredential(run.workspaceId, 'sk-workspace-secret');
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      harness: 'pi',
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'xhigh',
      credentials: {api_key: 'sk-workspace-secret'},
    });
    expect(resolveRuntimeCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: run.workspaceId,
        runId: run.id,
        stepAttemptId: expect.any(String),
      }),
    );
  });

  test('derives the credential workspace from the leased job instead of hostile lease claims', async () => {
    const {run, job, step} = await createRunningAgentStep();
    const hostileWorkspaceId = crypto.randomUUID();
    await saveWorkspaceCredential(run.workspaceId, 'sk-correct-workspace-secret');
    await saveWorkspaceCredential(hostileWorkspaceId, 'sk-hostile-workspace-secret');
    const token = await mintActiveLeaseToken({
      jobId: job.id,
      token: {workspaceId: hostileWorkspaceId},
    });

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe('sk-correct-workspace-secret');
  });

  test('returns decrypted runtime credentials for a gated running agent step', async () => {
    const {run, job, step} = await createRunningAgentStep({
      steps: [
        {
          name: 'implement',
          model: 'claude-opus-4-8',
          provider: 'anthropic',
          thinking: 'high',
          prompt: 'Fix the tests.',
          gate: {success: expression('step.exit_code == 0')},
        },
      ],
    });
    await saveWorkspaceCredential(run.workspaceId, 'sk-gated-workspace-secret');
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe('sk-gated-workspace-secret');
  });

  test('returns 404 when the lease token is no longer the active job lease', async () => {
    const {run, job, step} = await createRunningAgentStep();
    await insertRunningJobLease({
      workspaceId: run.workspaceId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      projectId: run.projectId,
      runnerSessionId: crypto.randomUUID(),
    });
    const token = await mintLeaseToken({
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      projectId: run.projectId,
      workspaceId: run.workspaceId,
      runnerSessionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });

  test('returns 404 when the step belongs to a different job', async () => {
    const {job: jobA} = await createRunningAgentStep();
    const {step: stepB} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: jobA.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(stepB.id, stepB.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
  });

  test('returns 409 when the requested attempt is stale', async () => {
    const {job, step} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt + 1),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-attempt-mismatch');
  });

  test.each([
    'pending',
    'succeeded',
    'failed',
    'cancelled',
  ] as const)('returns 409 when the step is %s', async (status) => {
    const {job, step} = await createRunningAgentStep({status});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-running');
  });

  test('returns 409 when the step is not an agent step', async () => {
    const {job, step} = await createRunningRunStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-agent');
  });

  test('returns 409 when the agent step config is malformed', async () => {
    const {job, step} = await createRunningAgentStep();
    await db()
      .update(stepsTable)
      .set({config: {provider: 'anthropic', model: 'claude-opus-4-8', prompt: 'missing thinking'}})
      .where(eq(stepsTable.id, step.id));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('agent-step-config-invalid');
  });

  test('returns 409 when credentials are unavailable', async () => {
    const {job, step} = await createRunningAgentStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('model-provider-not-configured');
  });

  test('returns managed provider policy details when workspace providers are disabled', async () => {
    const {job, step} = await createRunningAgentStep();
    resolveRuntimeCredentials.mockRejectedValueOnce(
      createInterModuleKnownError(
        agentInterModuleContract.methods.resolveRuntimeCredentials,
        'workspace-providers-disabled',
        {
          message: 'This instance only supports provider `shipfox`.',
          managed_provider_id: 'shipfox',
        },
      ),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workspace-providers-disabled',
      details: {
        message: 'This instance only supports provider `shipfox`.',
        managed_provider_id: 'shipfox',
      },
    });
  });

  test('includes a fallback message when managed provider details omit one', async () => {
    const {job, step} = await createRunningAgentStep();
    resolveRuntimeCredentials.mockRejectedValueOnce(
      createInterModuleKnownError(
        agentInterModuleContract.methods.resolveRuntimeCredentials,
        'workspace-providers-disabled',
        {managed_provider_id: 'shipfox'},
      ),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({
      code: 'workspace-providers-disabled',
      details: {
        message: 'Workspace provider configuration is disabled',
        managed_provider_id: 'shipfox',
      },
    });
  });

  test('returns 409 and reports when workspace credentials cannot be decrypted', async () => {
    const {job, step} = await createRunningAgentStep();
    resolveRuntimeCredentials.mockRejectedValueOnce(
      createInterModuleKnownError(
        agentInterModuleContract.methods.resolveRuntimeCredentials,
        'model-provider-credentials-invalid',
        {},
      ),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('model-provider-credentials-invalid');
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'InterModuleKnownError',
        code: 'model-provider-credentials-invalid',
      }),
    );
    expect(JSON.stringify(res.json())).not.toContain('sk-');
  });

  test('does not write returned credential material to logs', async () => {
    const {run, job, step} = await createRunningAgentStep();
    const secret = 'sk-super-secret-runtime-credential';
    await saveWorkspaceCredential(run.workspaceId, secret);
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'GET',
      url: runtimeConfigUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().credentials.api_key).toBe(secret);
    expect(logLines.join('\n')).not.toContain(secret);
  });
});

function runtimeConfigUrl(stepId: string, attempt: number): string {
  const search = new URLSearchParams({step_id: stepId, attempt: String(attempt)});
  return `${URL}?${search.toString()}`;
}

function saveWorkspaceCredential(workspaceId: string, apiKey: string): void {
  runtimeConfigs.set(workspaceId, {
    harness: 'pi',
    provider_id: 'anthropic',
    model: 'claude-opus-4-8',
    thinking: 'xhigh',
    credentials: {api_key: apiKey},
  });
}

type TestStepInput =
  | {
      name?: string;
      model?: string;
      provider?: string;
      thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
      prompt: string;
      gate?: WorkflowModel['jobs'][number]['steps'][number]['gate'];
    }
  | {run: string};
type TestWorkflowExpression = NonNullable<
  NonNullable<WorkflowModel['jobs'][number]['steps'][number]['gate']>['success']
>;

function expression(source: string): TestWorkflowExpression {
  return {language: 'cel', check: 'typed', source: source as TestWorkflowExpression['source']};
}

async function createRunningAgentStep(
  options: {
    status?: StepStatus;
    steps?: readonly TestStepInput[];
    workspaceId?: string;
    resolveAgentDefaults?: Parameters<typeof createWorkflowRun>[0]['resolveAgentDefaults'];
  } = {},
) {
  return await createStep({
    steps: options.steps ?? [{prompt: 'Fix the failing tests.'}],
    targetType: 'agent',
    status: options.status ?? 'running',
    workspaceId: options.workspaceId,
    resolveAgentDefaults: options.resolveAgentDefaults,
  });
}

async function createRunningRunStep() {
  return await createStep({
    steps: [{run: 'echo hello'}],
    targetType: 'run',
    status: 'running',
  });
}

async function createStep(params: {
  steps: readonly TestStepInput[];
  targetType: 'agent' | 'run';
  status: StepStatus;
  workspaceId?: string | undefined;
  resolveAgentDefaults?: Parameters<typeof createWorkflowRun>[0]['resolveAgentDefaults'];
}) {
  const run = await createWorkflowRun({
    workspaceId: params.workspaceId ?? crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps: params.steps}}}),
    resolveAgentDefaults: params.resolveAgentDefaults ?? resolveTestAgentDefaults,
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
  if (params.status === 'running') {
    await withTransaction((tx) =>
      insertRunningStepAttempt(
        {
          jobExecutionId: step.jobExecutionId,
          stepId: step.id,
          attempt: step.currentAttempt,
          config: step.config,
        },
        tx,
      ),
    );
  }

  return {
    run,
    job: {...job, status: 'running' as const},
    step: {...step, status: params.status},
  };
}
