import {
  WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX} from '#core/diagnostics.js';
import {nextStepForJob} from '#core/job-execution.js';
import {stripSetupStep} from '#test/fixtures/strip-setup-step.js';
import {
  buildModel,
  bulkUpdateJobStepStatuses,
  stepAttemptTerminatedEvents,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {stepAttempts as stepAttemptsTable} from '../schema/step-attempts.js';
import {steps as stepsTable} from '../schema/steps.js';
import {
  createWorkflowRun,
  finishStepAttempt,
  getFirstJobExecutionByJobId,
  getJobExecutionFailureOrigin,
  getJobsByWorkflowRunId,
  getLatestStepAttempt,
  getStepAttemptDetail,
  getStepAttempts,
  getStepsByJobId,
  insertRunningStepAttempt,
  markStepRunning,
} from '../workflow-runs.js';

describe('workflow run queries', () => {
  let workspaceId: string;
  let projectId: string;
  let definitionId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    definitionId = crypto.randomUUID();
  });

  describe('getStepsByJobId', () => {
    test('returns steps for a job ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}],
            },
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobSteps = await getStepsByJobId(runJobs[0]?.id as string);

      // The synthetic setup step occupies position 0; user steps follow at 1..3.
      expect(jobSteps).toHaveLength(4);
      expect(jobSteps[0]).toMatchObject({type: 'setup', position: 0});
      expect(jobSteps[1]?.position).toBe(1);
      expect(jobSteps[2]?.position).toBe(2);
      expect(jobSteps[3]?.position).toBe(3);
    });
  });

  describe('getStepAttemptDetail', () => {
    test('joins a step attempt to its run for lazy troubleshooting reads', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo hello'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);
      await nextStepForJob(job.id);

      const [attempt] = await getStepAttempts(job.id);
      if (!attempt) throw new Error('Expected a dispatched step attempt');

      await db()
        .update(stepsTable)
        .set({currentAttempt: attempt.attempt + 1})
        .where(eq(stepsTable.id, attempt.stepId));

      const detail = await getStepAttemptDetail({stepId: attempt.stepId, attempt: attempt.attempt});
      const scopedDetail = await getStepAttemptDetail({
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        workspaceId,
      });
      const latestAttempt = await getLatestStepAttempt({stepId: attempt.stepId, workspaceId});
      const foreignWorkspaceAttempt = await getLatestStepAttempt({
        stepId: attempt.stepId,
        workspaceId: crypto.randomUUID(),
      });
      const foreignScopedDetail = await getStepAttemptDetail({
        stepId: attempt.stepId,
        attempt: attempt.attempt,
        workspaceId: crypto.randomUUID(),
      });

      expect(detail).toMatchObject({
        workflowRunId: run.id,
        workflowRunAttemptId: job.workflowRunAttemptId,
        step: {id: attempt.stepId},
        attempt: {id: attempt.id, attempt: attempt.attempt},
      });
      expect(scopedDetail).toMatchObject({workflowRunId: run.id});
      expect(latestAttempt).toBe(attempt.attempt);
      expect(foreignWorkspaceAttempt).toBeUndefined();
      expect(foreignScopedDetail).toBeUndefined();

      await db()
        .update(stepAttemptsTable)
        .set({config: {run: 'x'.repeat(WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES)}})
        .where(eq(stepAttemptsTable.id, attempt.id));

      const oversizedDetail = await getStepAttemptDetail({
        stepId: attempt.stepId,
        attempt: attempt.attempt,
      });
      expect(oversizedDetail?.attempt.config).toBeNull();
      expect(oversizedDetail?.diagnosticBytes?.config).toBeGreaterThan(
        WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES,
      );
    });
  });

  describe('getLatestStepAttempt', () => {
    test('returns no attempt when the step has not been dispatched', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo hello'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);

      const [step] = await getStepsByJobId(job.id);
      if (!step) throw new Error('Expected a workflow step');

      await expect(getLatestStepAttempt({stepId: step.id, workspaceId})).resolves.toBeUndefined();
    });
  });

  describe('diagnostic write bounds', () => {
    test('enforces config and invocation limits when an attempt starts', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo hello'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);
      const [step] = await getStepsByJobId(job.id);
      if (!step) throw new Error('Expected a workflow step');

      await db()
        .update(stepsTable)
        .set({config: {run: 'x'.repeat(WORKFLOW_DIAGNOSTIC_CONFIG_MAX_BYTES)}})
        .where(eq(stepsTable.id, step.id));

      await expect(nextStepForJob(job.id)).rejects.toMatchObject({
        name: 'WorkflowDiagnosticTooLargeError',
        field: 'config',
      });
      await expect(
        db().select().from(stepAttemptsTable).where(eq(stepAttemptsTable.stepId, step.id)),
      ).resolves.toHaveLength(0);

      const invocations = Array.from(
        {length: WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX + 1},
        (_, callIndex) => ({
          call_index: callIndex,
          started_at: new Date('2026-08-05T12:00:00.000Z').toISOString(),
        }),
      );
      await expect(
        db().transaction((tx) =>
          insertRunningStepAttempt(
            {jobExecutionId: step.jobExecutionId, stepId: step.id, attempt: 1, invocations},
            tx,
          ),
        ),
      ).rejects.toMatchObject({
        name: 'WorkflowStepAttemptInvocationLimitError',
        count: WORKFLOW_STEP_ATTEMPT_INVOCATION_WRITE_MAX + 1,
      });
    });

    test('enforces output limits before an attempt finishes', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo hello'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);
      const [step] = await getStepsByJobId(job.id);
      if (!step) throw new Error('Expected a workflow step');
      const running = await db().transaction((tx) =>
        markStepRunning(
          {
            jobExecutionId: step.jobExecutionId,
            stepId: step.id,
          },
          tx,
        ),
      );
      if (!running) throw new Error('Expected the step to start');

      await expect(
        db().transaction((tx) =>
          finishStepAttempt(
            {
              stepId: step.id,
              attempt: running.currentAttempt,
              status: 'succeeded',
              output: {value: 'x'.repeat(WORKFLOW_DIAGNOSTIC_OUTPUT_MAX_BYTES)},
              logOutcome: 'drained',
            },
            tx,
          ),
        ),
      ).rejects.toMatchObject({
        name: 'WorkflowDiagnosticTooLargeError',
        field: 'output',
      });
      await expect(
        db()
          .select({status: stepAttemptsTable.status})
          .from(stepAttemptsTable)
          .where(eq(stepAttemptsTable.id, (await getStepAttempts(job.id))[0]?.id as string)),
      ).resolves.toEqual([{status: 'running'}]);
    });
  });

  describe('getJobExecutionFailureOrigin', () => {
    test('selects the current failed attempt instead of loading attempt history', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {build: {steps: [{run: 'echo hello'}, {run: 'echo goodbye'}]}},
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('Expected a job execution');
      await nextStepForJob(job.id);

      const [step] = await getStepsByJobId(job.id);
      const [attempt] = await getStepAttempts(job.id);
      if (!step || !attempt) throw new Error('Expected a current step attempt');
      await db()
        .update(stepsTable)
        .set({status: 'failed', error: {reason: 'command_failed', message: 'current failure'}})
        .where(eq(stepsTable.id, step.id));
      await db()
        .update(stepAttemptsTable)
        .set({
          status: 'failed',
          error: {reason: 'command_failed', message: 'current failure'},
          finishedAt: new Date(),
        })
        .where(eq(stepAttemptsTable.id, attempt.id));

      await expect(getJobExecutionFailureOrigin(execution.id)).resolves.toMatchObject({
        jobExecutionId: execution.id,
        stepId: step.id,
        stepAttempt: attempt.attempt,
        attemptStatus: 'failed',
        attemptError: {message: 'current failure'},
      });
    });

    test('returns the first step when the execution fails before any attempt starts', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo hello'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('Expected a job execution');

      await expect(getJobExecutionFailureOrigin(execution.id)).resolves.toMatchObject({
        jobExecutionId: execution.id,
        stepAttempt: 1,
        attemptStatus: null,
      });
    });

    test('selects a condition-errored step before an earlier pending step', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {build: {steps: [{run: 'echo first'}, {run: 'echo second'}]}},
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected a workflow job');
      await stripSetupStep(job.id);
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('Expected a job execution');

      const steps = await getStepsByJobId(job.id);
      const firstStep = steps[0];
      const conditionErroredStep = steps[1];
      if (!firstStep || !conditionErroredStep) throw new Error('Expected two workflow steps');
      await db()
        .update(stepsTable)
        .set({status: 'skipped', statusReason: 'condition_errored'})
        .where(eq(stepsTable.id, conditionErroredStep.id));

      await expect(getJobExecutionFailureOrigin(execution.id)).resolves.toMatchObject({
        stepId: conditionErroredStep.id,
        stepStatus: 'skipped',
      });
      expect(firstStep.position).toBeLessThan(conditionErroredStep.position);
    });
  });

  describe('bulkUpdateStepStatuses', () => {
    test('updates all steps for a job to the given sweep status', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'step1'}, {run: 'step2'}, {run: 'step3'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);

      const jobId = runJobs[0]?.id ?? '';
      await bulkUpdateJobStepStatuses({jobId, status: 'failed'});

      const jobSteps = await getStepsByJobId(jobId);
      expect(jobSteps).toHaveLength(4);
      for (const step of jobSteps) {
        expect(step.status).toBe('failed');
      }
    });

    test('does not downgrade a terminal step (terminal-state guard)', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}, {run: 'b'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const seeded = await getStepsByJobId(jobId);

      await db()
        .update(stepsTable)
        .set({status: 'succeeded'})
        .where(eq(stepsTable.id, seeded[0]?.id as string));
      await db()
        .update(stepsTable)
        .set({status: 'skipped', statusReason: 'condition_rejected'})
        .where(eq(stepsTable.id, seeded[1]?.id as string));

      await bulkUpdateJobStepStatuses({jobId, status: 'failed'});

      const final = await getStepsByJobId(jobId);
      expect(final[0]?.status).toBe('succeeded');
      expect(final[1]?.status).toBe('skipped');
      expect(final[1]?.statusReason).toBe('condition_rejected');
    });

    test('step attempts cannot be skipped', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      const [step] = await getStepsByJobId(jobId);
      if (!step) throw new Error('Expected arranged step');

      await expect(
        db().insert(stepAttemptsTable).values({
          stepId: step.id,
          jobExecutionId: step.jobExecutionId,
          attempt: 1,
          executionOrder: 1,
          status: 'skipped',
        }),
      ).rejects.toThrow();
    });

    test('terminal sweeps finalize running attempts as abandoned and emit attempt events', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'a'}]}}}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const jobId = runJobs[0]?.id ?? '';
      await stripSetupStep(jobId);
      await nextStepForJob(jobId);

      await bulkUpdateJobStepStatuses({jobId, status: 'cancelled'});

      const [attempt] = await getStepAttempts(jobId);
      expect(attempt).toMatchObject({status: 'cancelled', logOutcome: 'abandoned'});
      expect(await stepAttemptTerminatedEvents(jobId)).toMatchObject([
        {
          jobId,
          workflowRunId: run.id,
          workspaceId,
          projectId,
          stepId: attempt?.stepId,
          attempt: 1,
          status: 'cancelled',
          logOutcome: 'abandoned',
        },
      ]);
    });
  });
});
