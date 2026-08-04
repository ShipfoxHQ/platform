import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {closeApp, createApp, type FastifyInstance} from '@shipfox/node-fastify';
import {createCapturingLogger} from '@shipfox/node-log/test';
import {eq} from 'drizzle-orm';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {db} from '#db/db.js';
import {jobs as jobsTable} from '#db/schema/jobs.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {workflowRuns} from '#db/schema/workflow-runs.js';
import {createWorkflowRun, getJobsByWorkflowRunId, getStepsByJobId} from '#db/workflow-runs.js';
import {projectFactory} from '#test/factories/project.js';
import {workflowModel} from '#test/factories/workflow-model.js';
import {insertRunningJobLease, mintActiveLeaseToken} from '#test/fixtures/active-lease-token.js';
import {fakeLeaseTokenAuthMethod, mintLeaseToken} from '#test/fixtures/lease-token.js';
import {runnersTestClient} from '#test/fixtures/runners-inter-module.js';
import {createLeaseTokenRouteGroup} from './index.js';

const getProjectById = vi.fn();
const resolveCheckoutTarget = vi.fn();
const projects = {
  getProjectById,
  resolveCheckoutTarget,
} as Pick<ProjectsModuleClient, 'getProjectById' | 'resolveCheckoutTarget'>;

const createCheckoutSpec = vi.fn();
const integrations = {
  createCheckoutSpec,
} as Pick<IntegrationsModuleClient, 'createCheckoutSpec'>;

const {logger, lines: logLines, clear: clearLogLines} = createCapturingLogger();

const githubSpec = (token: string) => ({
  repositoryUrl: 'https://github.com/acme/repo.git',
  ref: 'main',
  credentials: {username: 'x-access-token', token, expiresAt: new Date('2026-06-10T12:00:00.000Z')},
});

describe('POST /runs/jobs/current/steps/:stepId/checkout-token', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      auth: [fakeLeaseTokenAuthMethod],
      routes: [
        createLeaseTokenRouteGroup({
          agent: {} as never,
          annotations: {} as never,
          auth: {} as never,
          integrations: integrations as never,
          projects: projects as never,
          runners: runnersTestClient,
          secrets: {} as never,
        }),
      ],
      swagger: false,
      fastifyOptions: {loggerInstance: logger},
    });
    await app.ready();
  });

  beforeEach(() => {
    createCheckoutSpec.mockReset();
    getProjectById.mockReset();
    resolveCheckoutTarget.mockReset();
    clearLogLines();
  });

  afterAll(async () => {
    await closeApp();
  });

  test('rejects a request without an Authorization header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(crypto.randomUUID(), 1),
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthorized');
  });

  test('does not keep the old job-scoped route as a compatibility alias', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runs/jobs/current/checkout-token',
    });

    expect(res.statusCode).toBe(404);
  });

  test('mints against the frozen setup-step config and returns its default fetch depth', async () => {
    const {project, job, step} = await createRunningCheckoutStep();
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue(githubSpec('ghs-secret-token'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      repository_url: 'https://github.com/acme/repo.git',
      ref: 'main',
      fetch_depth: 1,
      auth: {
        kind: 'basic',
        username: 'x-access-token',
        token: 'ghs-secret-token',
        expires_at: '2026-06-10T12:00:00.000Z',
        carry: 'header',
        host: 'github.com',
        persist: true,
      },
    });
    expect(resolveCheckoutTarget).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      defaults: {connectionId: project.sourceConnectionId, owner: 'acme'},
      target: {project: project.id},
    });
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      permissions: {contents: 'read'},
    });
  });

  test('defaults the checkout ref to the run trigger commit for the same project', async () => {
    const {run, project, job, step} = await createRunningCheckoutStep();
    const triggerReference = {
      project: {id: project.id},
      repository: 'acme/repo',
      ref: 'refs/heads/feature/checkout',
      commit: 'a'.repeat(40),
      actor: null,
    } satisfies WorkflowRunTriggerReference;
    await db().update(workflowRuns).set({triggerReference}).where(eq(workflowRuns.id, run.id));
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue(githubSpec('ghs-trigger-token'));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
      ref: triggerReference.commit,
      permissions: {contents: 'read'},
    });
  });

  test('returns checkout-unavailable when the run project no longer resolves', async () => {
    const {job, step} = await createRunningCheckoutStep({kind: 'checkout'});
    getProjectById.mockResolvedValue({project: null});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('checkout-unavailable');
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns a client error for a malformed project target', async () => {
    const {job, step} = await createRunningCheckoutStep({
      kind: 'checkout',
      checkout: {project: 'not-a-uuid'},
    });
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('checkout-config-invalid');
    expect(getProjectById).not.toHaveBeenCalled();
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('omits auth for a credential-free checkout spec', async () => {
    const {project, job, step} = await createRunningCheckoutStep();
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue({
      repositoryUrl: 'https://example.com/acme/repo.git',
      ref: 'trunk',
    });
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      repository_url: 'https://example.com/acme/repo.git',
      ref: 'trunk',
      fetch_depth: 1,
    });
  });

  test('mints an explicit checkout step from its target, ref, permissions, and fetch depth', async () => {
    const targetProjectId = crypto.randomUUID();
    const {project, job, step} = await createRunningCheckoutStep({
      kind: 'checkout',
      checkout: {
        project: targetProjectId,
        ref: 'refs/pull/412/head',
        fetchDepth: 0,
        permissions: {contents: 'write'},
        persistCredentials: false,
      },
    });
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: targetProjectId,
      connectionId: crypto.randomUUID(),
      externalRepositoryId: 'github:412',
    });
    createCheckoutSpec.mockResolvedValue({
      ...githubSpec('ghs-target-token'),
      ref: 'refs/pull/412/head',
    });
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ref: 'refs/pull/412/head', fetch_depth: 0});
    expect(res.json().auth.persist).toBe(false);
    expect(resolveCheckoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({target: {project: targetProjectId}}),
    );
    expect(createCheckoutSpec).toHaveBeenCalledWith({
      workspaceId: project.workspaceId,
      connectionId: expect.any(String),
      externalRepositoryId: 'github:412',
      ref: 'refs/pull/412/head',
      permissions: {contents: 'write'},
    });
  });

  test('uses the job scope instead of a hostile lease workspace claim', async () => {
    const {project, job, step} = await createRunningCheckoutStep();
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockResolvedValue(githubSpec('token'));
    const token = await mintActiveLeaseToken({
      jobId: job.id,
      token: {workspaceId: crypto.randomUUID()},
    });

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(resolveCheckoutTarget).toHaveBeenCalledWith(
      expect.objectContaining({workspaceId: project.workspaceId}),
    );
  });

  test('returns 404 and mints nothing when the lease is inactive', async () => {
    const {job, step} = await createRunningCheckoutStep();
    const token = await mintLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
    expect(resolveCheckoutTarget).not.toHaveBeenCalled();
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns 404 when the requested step belongs to another job', async () => {
    const first = await createRunningCheckoutStep();
    const second = await createRunningCheckoutStep();
    const token = await mintActiveLeaseToken({jobId: first.job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(second.step.id, second.step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('step-not-found');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns 409 for a stale step attempt', async () => {
    const {job, step} = await createRunningCheckoutStep();
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt + 1),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-attempt-mismatch');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test.each([
    'pending',
    'succeeded',
    'failed',
    'cancelled',
    'skipped',
  ] as const)('returns 409 when the checkout step is %s', async (status) => {
    const {job, step} = await createRunningCheckoutStep({status});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-running');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('returns 409 when the leased step is not a checkout step', async () => {
    const {job, step} = await createRunningCheckoutStep({kind: 'run'});
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('step-not-checkout');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('refuses a target outside the workspace while the lease remains active', async () => {
    const {project, job, step} = await createRunningCheckoutStep({
      kind: 'checkout',
      checkout: {project: crypto.randomUUID()},
    });
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockRejectedValue(
      createInterModuleKnownError(
        projectsInterModuleContract.methods.resolveCheckoutTarget,
        'checkout-repository-not-authorized',
        {},
      ),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('checkout-repository-not-authorized');
    expect(createCheckoutSpec).not.toHaveBeenCalled();
  });

  test('maps provider rate limiting to 429 without leaking credentials', async () => {
    const {project, job, step} = await createRunningCheckoutStep();
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    createCheckoutSpec.mockRejectedValue(
      createInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutSpec,
        'provider-failure',
        {reason: 'rate-limited', retryAfterSeconds: 60},
      ),
    );
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate-limited');
    expect(res.json().details.retry_after_seconds).toBe(60);
  });

  test('never writes the minted token to a log line', async () => {
    const {project, job, step} = await createRunningCheckoutStep();
    getProjectById.mockResolvedValue({project});
    resolveCheckoutTarget.mockResolvedValue({
      projectId: project.id,
      connectionId: project.sourceConnectionId,
      externalRepositoryId: project.sourceExternalRepositoryId,
    });
    const secret = 'ghs-super-secret-token-value';
    createCheckoutSpec.mockResolvedValue(githubSpec(secret));
    const token = await mintActiveLeaseToken({jobId: job.id});

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().auth.token).toBe(secret);
    expect(logLines.join('\n')).not.toContain(secret);
  });

  test('uses the active lease identity when a newer lease has replaced it', async () => {
    const {run, project, job, step} = await createRunningCheckoutStep();
    await insertRunningJobLease({
      workspaceId: project.workspaceId,
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      projectId: project.id,
      runnerSessionId: crypto.randomUUID(),
    });
    const token = await mintLeaseToken({
      jobId: job.id,
      jobExecutionId: step.jobExecutionId,
      runnerSessionId: crypto.randomUUID(),
    });

    const res = await app.inject({
      method: 'POST',
      url: checkoutUrl(step.id, step.currentAttempt),
      headers: {authorization: `Bearer ${token}`},
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('lease-not-active');
  });
});

function checkoutUrl(stepId: string, attempt: number): string {
  return `/runs/jobs/current/steps/${stepId}/checkout-token?attempt=${attempt}`;
}

type CheckoutConfig = {
  project?: string;
  connection?: string;
  repository?: string;
  ref?: string;
  fetchDepth?: number;
  permissions?: {contents: 'read' | 'write'};
  persistCredentials?: boolean;
};

async function createRunningCheckoutStep(
  options: {
    kind?: 'setup' | 'checkout' | 'run';
    checkout?: CheckoutConfig;
    status?: StepStatus;
  } = {},
) {
  const project = projectFactory.build();
  const checkout = {
    ...(options.checkout ?? {}),
    fetchDepth: options.checkout?.fetchDepth ?? 1,
    permissions: options.checkout?.permissions ?? {contents: 'read'},
    persistCredentials: options.checkout?.persistCredentials ?? true,
  } satisfies NonNullable<
    Extract<WorkflowModel['jobs'][number]['steps'][number], {kind: 'checkout'}>['checkout']
  >;
  const steps = options.kind === 'checkout' ? [{checkout}] : [{run: 'echo hello'}];
  const run = await createWorkflowRun({
    workspaceId: project.workspaceId,
    projectId: project.id,
    definitionId: crypto.randomUUID(),
    model: workflowModel({jobs: {build: {steps}}}),
    triggerPayload: {
      source: 'manual',
      event: 'fire',
      subscriptionId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    },
  });
  const [job] = await getJobsByWorkflowRunId(run.id);
  if (!job) throw new Error('Expected workflow job');
  await db().update(jobsTable).set({status: 'running'}).where(eq(jobsTable.id, job.id));

  const stepRows = await getStepsByJobId(job.id);
  const targetType =
    options.kind === 'checkout' ? 'checkout' : options.kind === 'run' ? 'run' : 'setup';
  const step = stepRows.find((candidate) => candidate.type === targetType);
  if (!step) throw new Error(`Expected ${targetType} step`);
  const status = options.status ?? 'running';
  await db().update(stepsTable).set({status}).where(eq(stepsTable.id, step.id));

  return {
    run,
    project,
    job: {...job, status: 'running' as const},
    step: {...step, status},
  };
}
