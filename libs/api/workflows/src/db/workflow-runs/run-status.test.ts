import {eq} from 'drizzle-orm';
import {WorkflowRunNotCancellableError} from '#core/errors.js';
import {nextStepForJob} from '#core/job-execution.js';
import {
  buildModel,
  createTestRun,
  jobExecutionTerminatedEvents,
  jobTerminatedEvents,
  runCancelledEvents,
  runTerminatedEvents,
  stepAttemptTerminatedEvents,
} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {workflowRunAttempts} from '../schema/workflow-run-attempts.js';
import {workflowRuns} from '../schema/workflow-runs.js';
import {
  cancelWorkflowRun,
  createRerunWorkflowRun,
  createWorkflowRun,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getStepsByJobId,
  getWorkflowRunById,
  listRunAttempts,
  updateJobStatus,
  updateWorkflowRunStatus,
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

  describe('updateWorkflowRunStatus', () => {
    test('updates status and increments version', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const updated = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('preserves terminal status reason when a later transition is ignored', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      const job = (await getJobsByWorkflowRunId(run.id))[0];

      const skipped = await updateJobStatus({
        jobId: job?.id as string,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });
      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 2,
      });

      expect(skipped.statusReason).toBe('dependency_not_completed');
      expect(retry.status).toBe('skipped');
      expect(retry.statusReason).toBe('dependency_not_completed');
    });

    test('throws on version mismatch', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      await expect(
        updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('throws when run not found', async () => {
      await expect(
        updateWorkflowRunStatus({
          workflowRunId: crypto.randomUUID(),
          status: 'running',
          expectedVersion: 1,
        }),
      ).rejects.toThrow('Workflow run not found');
    });

    test.each([
      'succeeded',
      'failed',
      'cancelled',
    ] as const)('writes one run-terminated event when the status becomes %s', async (status) => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({workflowRunId: run.id, status, expectedVersion: 1});

      const events = await runTerminatedEvents(run.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({workflowRunId: run.id, projectId: run.projectId, status});
    });

    test('writes no run-terminated event for a non-terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});

      expect(await runTerminatedEvents(run.id)).toHaveLength(0);
    });

    test('does not mirror a non-current attempt terminal update to the run', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const attempts = await listRunAttempts({workflowRunId: run.id, projectId});
      const firstAttempt = attempts[0];
      if (!firstAttempt) throw new Error('Expected initial attempt');
      await db().insert(workflowRunAttempts).values({
        workflowRunId: run.id,
        attempt: 2,
        status: 'succeeded',
      });
      await db()
        .update(workflowRuns)
        .set({currentAttempt: 2, status: 'succeeded'})
        .where(eq(workflowRuns.id, run.id));

      const staleUpdate = await updateWorkflowRunStatus({
        workflowRunAttemptId: firstAttempt.id,
        status: 'failed',
        expectedVersion: 1,
      });

      expect(staleUpdate.status).toBe('succeeded');
      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'succeeded',
        currentAttempt: 2,
      });
      expect(await runTerminatedEvents(run.id)).toHaveLength(0);
    });

    test('idempotent retry: a second terminal update at the stale version emits once', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const first = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'failed',
        expectedVersion: 1,
      });

      expect(retry.version).toBe(first.version);
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });

    test('terminal-tolerant mismatch: existing terminal run returns without re-emitting', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const cancelled = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });

    test('terminal-tolerant match: existing terminal run cannot be revived at the current version', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const cancelled = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: cancelled.version,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'cancelled',
        version: cancelled.version,
      });
      expect(await runTerminatedEvents(run.id)).toHaveLength(1);
    });
  });

  describe('cancelWorkflowRun', () => {
    test('cancels the run, non-terminal jobs, and only their non-terminal steps', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            running: {steps: [{run: 'a'}, {run: 'b'}]},
            succeeded: {steps: [{run: 'ok'}]},
            skipped: {steps: [{run: 'skip'}]},
          },
        }),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});
      const [runningJobExecution, succeededJob, skippedJob] = await getJobsByWorkflowRunId(run.id);
      if (!runningJobExecution || !succeededJob || !skippedJob) throw new Error('Expected jobs');
      await updateJobStatus({jobId: runningJobExecution.id, status: 'running', expectedVersion: 1});
      const execution = await getFirstJobExecutionByJobId(runningJobExecution.id);
      if (!execution) throw new Error('Expected running job execution');
      await nextStepForJob(runningJobExecution.id);
      await updateJobStatus({jobId: succeededJob.id, status: 'succeeded', expectedVersion: 1});
      await updateJobStatus({
        jobId: skippedJob.id,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });

      const cancelled = await cancelWorkflowRun({workflowRunId: run.id});

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.finishedAt).not.toBeNull();
      const [finalRunning, finalSucceeded, finalSkipped] = await getJobsByWorkflowRunId(run.id);
      expect(finalRunning).toMatchObject({status: 'cancelled', statusReason: 'run_cancelled'});
      expect(finalSucceeded).toMatchObject({status: 'succeeded', statusReason: null});
      expect(finalSkipped).toMatchObject({
        status: 'skipped',
        statusReason: 'dependency_not_completed',
      });
      expect((await getStepsByJobId(runningJobExecution.id)).map((step) => step.status)).toEqual([
        'cancelled',
        'cancelled',
        'cancelled',
      ]);
      expect(
        (await getStepsByJobId(skippedJob.id)).every((step) => step.status === 'pending'),
      ).toBe(true);
      expect(await runTerminatedEvents(run.id)).toEqual([
        expect.objectContaining({workflowRunId: run.id, projectId, status: 'cancelled'}),
      ]);
      expect(await runCancelledEvents(run.id)).toEqual([
        expect.objectContaining({workflowRunId: run.id, projectId}),
      ]);
      expect(await jobTerminatedEvents(runningJobExecution.id)).toEqual([
        expect.objectContaining({
          jobId: runningJobExecution.id,
          workflowRunId: run.id,
          status: 'cancelled',
          statusReason: 'run_cancelled',
        }),
      ]);
      expect(await jobExecutionTerminatedEvents(execution.id)).toEqual([
        expect.objectContaining({
          jobId: runningJobExecution.id,
          jobExecutionId: execution.id,
          workflowRunId: run.id,
          status: 'cancelled',
          statusReason: 'run_cancelled',
        }),
      ]);
      expect(await stepAttemptTerminatedEvents(runningJobExecution.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(succeededJob.id)).toHaveLength(1);
      expect(await jobTerminatedEvents(skippedJob.id)).toHaveLength(1);
    });

    test('cancels the current rerun attempt after current_attempt moves', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'failed', expectedVersion: 1});
      const firstAttempt = (await listRunAttempts({workflowRunId: run.id, projectId}))[0];
      if (!firstAttempt) throw new Error('Expected initial attempt');
      await createRerunWorkflowRun({
        workflowRunId: run.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const secondAttempt = (await listRunAttempts({workflowRunId: run.id, projectId})).find(
        (attempt) => attempt.attempt === 2,
      );
      if (!secondAttempt) throw new Error('Expected rerun attempt');
      await updateWorkflowRunStatus({workflowRunId: run.id, status: 'running', expectedVersion: 1});

      await cancelWorkflowRun({workflowRunId: run.id});

      expect(await runCancelledEvents(run.id)).toEqual([
        expect.objectContaining({
          workflowRunId: run.id,
          workflowRunAttemptId: secondAttempt.id,
          projectId,
        }),
      ]);
      const terminatedEvents = await runTerminatedEvents(run.id);
      expect(terminatedEvents).toHaveLength(2);
      expect(terminatedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workflowRunId: run.id,
            workflowRunAttemptId: firstAttempt.id,
            projectId,
            status: 'failed',
          }),
          expect.objectContaining({
            workflowRunId: run.id,
            workflowRunAttemptId: secondAttempt.id,
            projectId,
            status: 'cancelled',
          }),
        ]),
      );
    });

    test('throws without changing an already-terminal run', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const finished = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'succeeded',
        expectedVersion: 1,
      });

      await expect(cancelWorkflowRun({workflowRunId: run.id})).rejects.toBeInstanceOf(
        WorkflowRunNotCancellableError,
      );

      expect(await getWorkflowRunById(run.id)).toMatchObject({
        status: 'succeeded',
        version: finished.version,
      });
      expect(await runCancelledEvents(run.id)).toHaveLength(0);
    });
  });

  describe('run lifecycle timing', () => {
    test('run: stamps started_at on running and preserves it through the terminal transition', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const running = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      expect(running.startedAt).not.toBeNull();
      expect(running.finishedAt).toBeNull();

      const finished = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'succeeded',
        expectedVersion: 2,
      });

      expect(finished.finishedAt).not.toBeNull();
      expect(finished.startedAt?.getTime()).toBe(running.startedAt?.getTime());
    });

    test('run: cancelled straight from pending has no start but a finish', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});

      const cancelled = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'cancelled',
        expectedVersion: 1,
      });

      expect(cancelled.startedAt).toBeNull();
      expect(cancelled.finishedAt).not.toBeNull();
    });

    test('run: re-entering running keeps the first started_at (coalesce, not a fresh clock)', async () => {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const firstRunning = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 1,
      });

      const secondRunning = await updateWorkflowRunStatus({
        workflowRunId: run.id,
        status: 'running',
        expectedVersion: 2,
      });

      expect(secondRunning.startedAt?.getTime()).toBe(firstRunning.startedAt?.getTime());
    });
  });
});
