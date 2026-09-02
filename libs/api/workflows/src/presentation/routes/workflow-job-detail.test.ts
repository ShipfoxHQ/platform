import {buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES,
  workflowExecutionStepsResponseSchema,
  workflowJobDetailResponseSchema,
  workflowJobExecutionContextResponseSchema,
  workflowJobExecutionSummariesResponseSchema,
  workflowStepAttemptSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {eq, sql} from 'drizzle-orm';
import type {FastifyInstance} from 'fastify';
import Fastify from 'fastify';
import {serializerCompiler, validatorCompiler} from 'fastify-type-provider-zod';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';
import {db} from '#db/db.js';
import * as dbIndex from '#db/index.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {jobs} from '#db/schema/jobs.js';
import {stepAttempts} from '#db/schema/step-attempts.js';
import {steps} from '#db/schema/steps.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {getJobDetailRoute} from './get-job-detail.js';
import {getJobExecutionContextRoute} from './get-job-execution-context.js';
import {listExecutionStepsRoute} from './list-execution-steps.js';
import {listJobExecutionsRoute} from './list-job-executions.js';
import {listStepAttemptsRoute} from './list-step-attempts.js';

const getProjectById = vi.fn();
const projects = {
  getProjectById,
  requireProjectForWorkspace: vi.fn(),
} as unknown as ProjectsModuleClient;

describe('selected workflow job routes', () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    app.get('/api/workflows/runs/jobs/:jobId', getJobDetailRoute(projects));
    app.get(
      '/api/workflows/runs/jobs/:jobId/executions/:executionId/context',
      getJobExecutionContextRoute(projects),
    );
    app.get('/api/workflows/runs/jobs/:jobId/executions', listJobExecutionsRoute(projects));
    app.get(
      '/api/workflows/runs/jobs/:jobId/executions/:executionId/steps',
      listExecutionStepsRoute(projects),
    );
    app.get('/api/workflows/runs/steps/:stepId/attempts', listStepAttemptsRoute(projects));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    getProjectById.mockImplementation(({projectId}) =>
      Promise.resolve({
        project: {
          id: projectId,
          workspaceId,
          sourceConnectionId: crypto.randomUUID(),
          sourceExternalRepositoryId: `repo:${crypto.randomUUID()}`,
          name: 'Project',
        },
      }),
    );
  });

  test('returns a schema-valid selected job with the active execution', async () => {
    const fixture = await createFixture();

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowJobDetailResponseSchema.safeParse(body).success).toBe(true);
    expect(body.workflow_run_id).toBe(fixture.run.id);
    expect(body.workflow_run_attempt).toBe(1);
    expect(body.job.id).toBe(fixture.jobIds[0]);
    expect(body.selected_execution.id).toBe(fixture.executionIds[0]);
    expect(body.selected_execution.steps.total).toBe(2);
    expect(body.selected_execution.steps.items[0].attempts.total).toBe(2);
    expect(body.selected_execution).not.toHaveProperty('runner');
    expect(body.selected_execution.steps.items[0]).not.toHaveProperty('config');
  });

  test('loads diagnostic context only from the selected execution', async () => {
    const fixture = await createFixture({stepsPerExecution: 1});
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const trace: readonly PersistedEvaluationTraceEntry[] = [
      {
        expression: 'inputs.environment',
        roots: ['inputs.environment'],
        fillTarget: 'job-activation',
        evaluatedAt: 'job-activation',
        field: 'job.if',
        value: 'production',
      },
    ];
    const triggerEvent = {
      source: 'github',
      event: 'push',
      delivery_id: crypto.randomUUID(),
      received_at: new Date('2026-08-05T12:00:00.000Z').toISOString(),
      project: null,
      repository: 'shipfox/platform',
      ref: 'main',
      commit: 'abc123',
      data: {ref: 'refs/heads/main'},
    };

    await db()
      .update(jobs)
      .set({
        runner: ['job-runner'],
        outputs: {job_output: 'ready'},
        evaluationTrace: trace,
        success: 'steps.test.status == "succeeded"',
      })
      .where(eq(jobs.id, jobId));
    await db()
      .update(jobExecutions)
      .set({
        runner: ['execution-runner'],
        outputs: {execution_output: 'ready'},
        evaluationTrace: trace,
        triggerEvents: [triggerEvent],
      })
      .where(eq(jobExecutions.id, executionId));

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/context`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(workflowJobExecutionContextResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      workflow_run_id: fixture.run.id,
      workflow_run_attempt: 1,
      job_id: jobId,
      job_execution_id: executionId,
      job_runner: ['job-runner'],
      execution_runner: ['execution-runner'],
      job_outputs: {job_output: 'ready'},
      execution_outputs: {execution_output: 'ready'},
      condition: 'steps.test.status == "succeeded"',
      oversized_fields: [],
    });
    expect(body.trigger_events).toEqual([triggerEvent]);
    expect(body.job_evaluation_trace).toHaveLength(1);
    expect(body.execution_evaluation_trace).toHaveLength(1);

    const selectedJob = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}`,
    });
    expect(selectedJob.statusCode).toBe(200);
    expect(selectedJob.json().selected_execution).not.toHaveProperty('runner');
    expect(selectedJob.json().selected_execution).not.toHaveProperty('outputs');
    expect(selectedJob.json().selected_execution).not.toHaveProperty('evaluation_trace');
  });

  test('describes oversized legacy context values without failing the response', async () => {
    const fixture = await createFixture({stepsPerExecution: 1});
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const jobOutputs = {legacy: 'x'.repeat(WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES)};
    const executionOutputs = {legacy: 'y'.repeat(WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES)};

    await db().update(jobs).set({outputs: jobOutputs}).where(eq(jobs.id, jobId));
    await db()
      .update(jobExecutions)
      .set({outputs: executionOutputs})
      .where(eq(jobExecutions.id, executionId));

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/context`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().job_outputs).toBeNull();
    expect(response.json().execution_outputs).toBeNull();
    expect(response.json().oversized_fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'job_outputs',
          reason: 'legacy_value_exceeds_inline_limit',
        }),
        expect.objectContaining({
          field: 'execution_outputs',
          reason: 'legacy_value_exceeds_inline_limit',
        }),
      ]),
    );
  });

  test('paginates execution, step, and step-attempt summaries', async () => {
    const fixture = await createFixture({
      executionsPerJob: 3,
      stepsPerExecution: 3,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const stepId = fixture.stepIds[0] as string;

    const executions = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?limit=2`,
    });
    expect(executions.statusCode).toBe(200);
    expect(workflowJobExecutionSummariesResponseSchema.safeParse(executions.json()).success).toBe(
      true,
    );
    expect(executions.json().items.map((item: {sequence: number}) => item.sequence)).toEqual([
      3, 2,
    ]);
    expect(executions.json().total).toBe(3);

    const executionContinuation = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?limit=2&cursor=${executions.json().next_cursor}`,
    });
    expect(executionContinuation.statusCode).toBe(200);
    expect(
      executionContinuation.json().items.map((item: {sequence: number}) => item.sequence),
    ).toEqual([1]);
    expect(executionContinuation.json()).not.toHaveProperty('total');

    const steps = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=2`,
    });
    expect(steps.statusCode).toBe(200);
    expect(workflowExecutionStepsResponseSchema.safeParse(steps.json()).success).toBe(true);
    expect(steps.json().items.map((item: {position: number}) => item.position)).toEqual([0, 1]);
    expect(steps.json().total).toBe(3);

    const attempts = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${stepId}/attempts?limit=2`,
    });
    expect(attempts.statusCode).toBe(200);
    expect(workflowStepAttemptSummariesResponseSchema.safeParse(attempts.json()).success).toBe(
      true,
    );
    expect(attempts.json().items.map((item: {attempt: number}) => item.attempt)).toEqual([3, 2]);
    expect(attempts.json().total).toBe(3);
  });

  test('logs the measured database duration when execution history fails', async () => {
    const fixture = await createFixture();
    const infoSpy = vi.spyOn(logger(), 'info');
    const executionReadSpy = vi
      .spyOn(dbIndex, 'listWorkflowJobExecutionSummaries')
      .mockImplementationOnce((_params, options) => {
        options?.onRead?.({databaseDurationMilliseconds: 7, returnedRows: 1});
        return Promise.reject(new Error('database connection lost'));
      });

    const response = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}/executions`,
    });

    expect(response.statusCode).toBe(500);
    expect(executionReadSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'workflow-runs/jobs/:jobId/executions',
        outcome: 'error',
        databaseDurationMs: 7,
      }),
      'Listed workflow job executions',
    );
  });

  test('bounds embedded attempt previews and sanitizes legacy error and gate payloads', async () => {
    const fixture = await createFixture({attemptsPerStep: 12});
    const stepId = fixture.stepIds[0] as string;
    const newestAttemptId = fixture.stepAttemptIds[11] as string;
    await db()
      .update(stepAttempts)
      .set({
        error: {message: `${'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH - 1)}😀`},
        gateResult: {
          passed: true,
          source: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1),
          exit_code: 0,
        },
      })
      .where(eq(stepAttempts.id, newestAttemptId));
    await db()
      .update(stepAttempts)
      .set({
        gateResult: {
          passed: false,
          uncheckable: true,
          reason: 'r'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1),
          exit_code: 1,
        },
      })
      .where(eq(stepAttempts.id, fixture.stepAttemptIds[10] as string));
    await db()
      .update(stepAttempts)
      .set({gateResult: {legacy: 'payload'}})
      .where(eq(stepAttempts.id, fixture.stepAttemptIds[23] as string));

    const detail = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}`,
    });
    const body = detail.json();
    const embeddedAttempts = body.selected_execution.steps.items[0].attempts;

    expect(detail.statusCode).toBe(200);
    expect(embeddedAttempts.items).toHaveLength(10);
    expect(embeddedAttempts.items.map((item: {attempt: number}) => item.attempt)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
    ]);
    expect(embeddedAttempts.items[0].error.message).toHaveLength(STEP_ERROR_MESSAGE_MAX_LENGTH - 1);
    expect(embeddedAttempts.items[0].gate_result.source).toHaveLength(
      STEP_ERROR_MESSAGE_MAX_LENGTH,
    );
    expect(embeddedAttempts.items[1].gate_result.reason).toHaveLength(
      STEP_ERROR_MESSAGE_MAX_LENGTH,
    );
    expect(body.selected_execution.steps.items[1].attempts.items[0].gate_result).toEqual({
      kind: 'unknown',
    });
    expect(embeddedAttempts.next_cursor).toEqual(expect.any(String));

    const continuation = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/steps/${stepId}/attempts?cursor=${embeddedAttempts.next_cursor}`,
    });
    expect(continuation.statusCode).toBe(200);
    expect(continuation.json().items.map((item: {attempt: number}) => item.attempt)).toEqual([
      2, 1,
    ]);
    expect(continuation.json()).not.toHaveProperty('total');
  });

  test('masks wrong ancestry and malformed cursors as stable API errors', async () => {
    const fixture = await createFixture({jobs: 2, executionsPerJob: 1});
    const jobId = fixture.jobIds[0] as string;

    const wrongExecution = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions/${fixture.executionIds[1]}/steps`,
    });
    const malformedCursor = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?cursor=not-a-cursor`,
    });

    expect(wrongExecution.statusCode).toBe(404);
    expect(wrongExecution.json().code).toBe('not-found');
    expect(malformedCursor.statusCode).toBe(400);
    expect(malformedCursor.json().code).toBe('invalid-cursor');
  });

  test('returns empty selections and nested pages, and honors an explicit execution', async () => {
    const fixture = await createFixture({executionsPerJob: 2, stepsPerExecution: 1});
    const jobId = fixture.jobIds[0] as string;
    const secondExecutionId = fixture.executionIds[1] as string;
    const emptyJobId = crypto.randomUUID();
    const emptyStepId = crypto.randomUUID();

    await db().insert(jobs).values({
      id: emptyJobId,
      workflowRunAttemptId: fixture.workflowRunAttemptId,
      key: 'empty-job',
      checkoutPersistCredentials: true,
      checkoutPermissionsContents: 'read',
      dependencies: [],
      position: 10,
    });

    const emptyJob = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${emptyJobId}`,
    });
    expect(emptyJob.statusCode).toBe(200);
    expect(emptyJob.json().selected_execution).toBeNull();

    const explicitExecution = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}?execution_id=${secondExecutionId}`,
    });
    expect(explicitExecution.statusCode).toBe(200);
    expect(explicitExecution.json().selected_execution.sequence).toBe(2);

    await db()
      .insert(steps)
      .values({
        id: emptyStepId,
        jobExecutionId: fixture.executionIds[0] as string,
        key: 'empty-step',
        name: 'Empty step',
        type: 'run',
        config: {},
        position: 10,
      });
    const detail = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}`,
    });
    expect(
      detail
        .json()
        .selected_execution.steps.items.find((step: {id: string}) => step.id === emptyStepId)
        .attempts,
    ).toEqual({items: [], next_cursor: null, total: 0});
  });

  test('masks every selected-job route for an inaccessible workspace', async () => {
    const fixture = await createFixture();
    getProjectById.mockRejectedValue(
      new ClientError('Project forbidden', 'forbidden', {status: 403}),
    );

    const responses = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}`,
      }),
      app.inject({
        method: 'GET',
        url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}/executions`,
      }),
      app.inject({
        method: 'GET',
        url: `/api/workflows/runs/jobs/${fixture.jobIds[0]}/executions/${fixture.executionIds[0]}/steps`,
      }),
      app.inject({
        method: 'GET',
        url: `/api/workflows/runs/steps/${fixture.stepIds[0]}/attempts`,
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe('not-found');
    }
  });

  test('rejects page and cursor values outside the bounded contract', async () => {
    const fixture = await createFixture();
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const stepId = fixture.stepIds[0] as string;
    const outOfRangeCursor = Buffer.from(
      JSON.stringify({value: '2147483648', id: crypto.randomUUID()}),
      'utf8',
    ).toString('base64url');
    const urls = [
      `/api/workflows/runs/jobs/${jobId}/executions?limit=0`,
      `/api/workflows/runs/jobs/${jobId}/executions?limit=101`,
      `/api/workflows/runs/jobs/${jobId}/executions?limit=abc`,
      `/api/workflows/runs/jobs/${jobId}/executions?limit=2.5`,
      `/api/workflows/runs/jobs/${jobId}/executions?cursor=`,
      `/api/workflows/runs/jobs/${jobId}/executions?cursor=${outOfRangeCursor}`,
      `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=0`,
      `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=101`,
      `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?cursor=not-a-cursor`,
      `/api/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?cursor=${outOfRangeCursor}`,
      `/api/workflows/runs/steps/${stepId}/attempts?limit=0`,
      `/api/workflows/runs/steps/${stepId}/attempts?limit=101`,
      `/api/workflows/runs/steps/${stepId}/attempts?cursor=not-a-cursor`,
      `/api/workflows/runs/steps/${stepId}/attempts?cursor=${outOfRangeCursor}`,
    ];

    for (const url of urls) {
      const response = await app.inject({method: 'GET', url});
      expect(response.statusCode).toBe(400);
    }
  });

  test('derives context and pending display status and bounds large history totals', async () => {
    const fixture = await createFixture({stepsPerExecution: 1});
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    await db()
      .update(jobExecutions)
      .set({
        status: 'running',
        runner: null,
        triggerEvents: sql`'{"legacy": true}'::jsonb`,
        statusReasonMessage: 'r'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1),
      })
      .where(eq(jobExecutions.id, executionId));

    const pending = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}`,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().selected_execution.has_context).toBe(false);
    expect(pending.json().selected_execution.display_status).toBe('pending');
    expect(pending.json().selected_execution.status_reason_message).toHaveLength(
      STEP_ERROR_MESSAGE_MAX_LENGTH,
    );

    await db()
      .update(jobExecutions)
      .set({runner: ['runner']})
      .where(eq(jobExecutions.id, executionId));
    const withContext = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}?execution_id=${executionId}`,
    });
    expect(withContext.json().selected_execution.has_context).toBe(true);

    await db()
      .insert(jobExecutions)
      .values(
        Array.from({length: 100}, (_, index) => ({
          id: crypto.randomUUID(),
          jobId,
          sequence: index + 2,
          status: 'succeeded' as const,
          triggerEvents: [],
          updatedAt: new Date(),
        })),
      );
    const executions = await app.inject({
      method: 'GET',
      url: `/api/workflows/runs/jobs/${jobId}/executions?limit=1`,
    });
    expect(executions.statusCode).toBe(200);
    expect(executions.json().total).toBe('100+');
  });

  async function createFixture(
    options: Parameters<typeof createHighCardinalityWorkflowRun>[0] = {},
  ) {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 2,
      attemptsPerStep: 2,
      ...options,
    });
    workspaceId = fixture.run.workspaceId;
    return fixture;
  }
});
