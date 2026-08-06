import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import type {Step, StepAttempt} from '#core/entities/step.js';
import * as dbMocks from '#db/index.js';
import {getStepAttemptDetailRoute} from './get-step-attempt-detail.js';

vi.mock('#db/index.js', () => ({
  getStepAttemptDetail: vi.fn(),
  getWorkflowRunById: vi.fn(),
}));

const getProjectById = vi.fn();
const projects = {getProjectById} as unknown as ProjectsModuleClient;
const STEP_ID = crypto.randomUUID();
const getStepAttemptDetail = vi.mocked(dbMocks.getStepAttemptDetail);
const getWorkflowRunById = vi.mocked(dbMocks.getWorkflowRunById);

describe('GET /api/workflows/runs/steps/:stepId/attempts/:attempt', () => {
  let app: FastifyInstance;
  let workspaceId: string;
  const workflowRunId = crypto.randomUUID();
  const projectId = crypto.randomUUID();

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
    app.get(
      '/api/workflows/runs/steps/:stepId/attempts/:attempt',
      getStepAttemptDetailRoute(projects),
    );
    await app.ready();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    vi.clearAllMocks();
    getProjectById.mockResolvedValue({
      project: {id: projectId, workspaceId, name: 'Project'},
    });
    getWorkflowRunById.mockResolvedValue({projectId} as never);
  });

  it('returns the requested attempt detail for an accessible run', async () => {
    const step = stepEntity();
    const attempt = stepAttemptEntity();
    getStepAttemptDetail.mockResolvedValue({
      workflowRunId,
      workflowRunAttemptId: crypto.randomUUID(),
      step,
      attempt,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${STEP_ID}/attempts/1`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      step_id: STEP_ID,
      attempt: 1,
      authored_config: {run: 'pnpm test'},
      config: {run: 'pnpm test'},
    });
    expect(getProjectById).toHaveBeenCalledWith({projectId});
  });

  it('returns 404 for a missing attempt', async () => {
    getStepAttemptDetail.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${STEP_ID}/attempts/1`,
    });

    expect(response.statusCode).toBe(404);
    expect(getProjectById).not.toHaveBeenCalled();
  });

  it('returns 404 for an attempt in an inaccessible run', async () => {
    getStepAttemptDetail.mockResolvedValue({
      workflowRunId,
      workflowRunAttemptId: crypto.randomUUID(),
      step: stepEntity(),
      attempt: stepAttemptEntity(),
    });
    getProjectById.mockRejectedValueOnce(new ClientError('Forbidden', 'forbidden', {status: 403}));

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${STEP_ID}/attempts/1`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not-found');
  });
});

function stepEntity(): Step {
  return {
    id: STEP_ID,
    jobExecutionId: crypto.randomUUID(),
    key: 'test',
    name: 'Run tests',
    sourceLocation: null,
    status: 'failed',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {run: 'pnpm test'},
    condition: null,
    configPlan: null,
    authoredConfig: {run: 'pnpm test'},
    error: {reason: 'command_failed', message: 'Command failed'},
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    updatedAt: new Date('2026-08-05T12:01:00.000Z'),
  };
}

function stepAttemptEntity(): StepAttempt {
  return {
    id: crypto.randomUUID(),
    stepId: STEP_ID,
    attempt: 1,
    executionOrder: 1,
    status: 'failed',
    config: {run: 'pnpm test'},
    evaluationTrace: null,
    output: {result: 'failed'},
    response: null,
    error: {reason: 'command_failed', message: 'Command failed'},
    exitCode: 1,
    gateResult: null,
    restartFeedback: null,
    logOutcome: 'drained',
    startedAt: new Date('2026-08-05T12:00:00.000Z'),
    finishedAt: new Date('2026-08-05T12:01:00.000Z'),
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
  };
}
