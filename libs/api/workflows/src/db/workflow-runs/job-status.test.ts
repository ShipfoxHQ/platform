import {eq, sql} from 'drizzle-orm';
import {buildModel, createTestRun, jobTerminatedEvents} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobs} from '../schema/jobs.js';
import {
  createWorkflowRun,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  resolveJobStatusFromJobExecutions,
  updateJobExecutionStatus,
  updateJobStatus,
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

  describe('resolveJobStatusFromJobExecutions', () => {
    test('fails closed when a job has no executions', async () => {
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
      const [existingJob] = await getJobsByWorkflowRunId(run.id);
      if (!existingJob) throw new Error('Expected workflow job');
      const [job] = await db()
        .insert(jobs)
        .values({
          workflowRunAttemptId: existingJob.workflowRunAttemptId,
          key: 'no-execution',
          name: null,
          checkoutPersistCredentials: true,
          checkoutPermissionsContents: 'read',
          dependencies: [],
          runner: ['ubuntu-latest'],
          position: 99,
        })
        .returning();
      if (!job) throw new Error('Expected workflow job');

      const resolve = resolveJobStatusFromJobExecutions({jobId: job.id});

      await expect(resolve).rejects.toThrow('no job executions found');
    });

    test('resolves the default success expression over execution rows', async () => {
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
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({status: 'succeeded'});
    });

    test('fails the job when the default success expression is false', async () => {
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
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'failed',
        expectedVersion: jobExecution.version,
        statusReason: 'step_failed',
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('failed');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'failed',
        statusReason: 'step_failed',
      });
    });

    test('resolves custom job success expressions over execution rows', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              success: 'executions.exists(e, e.status == "failed")',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'failed',
        expectedVersion: jobExecution.version,
        statusReason: 'step_failed',
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'succeeded',
        statusReason: null,
      });
    });

    test('resolves a custom success expression over the full execution shape', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              name: 'Build',
              success: 'executions.all(e, e.status == "succeeded" && e.name == "Build")',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});

      expect(resolved.status).toBe('succeeded');
    });

    test('resolves custom job success expressions over direct dependency outputs', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {steps: [{run: 'build'}]},
            deploy: {
              needs: ['build'],
              success: 'jobs.build.status == "succeeded" && jobs.build.outputs.release == "yes"',
              steps: [{run: 'deploy'}],
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
      const build = runJobs.find((job) => job.key === 'build');
      const deploy = runJobs.find((job) => job.key === 'deploy');
      if (!build || !deploy) throw new Error('Expected workflow jobs');
      await db()
        .update(jobs)
        .set({status: 'succeeded', outputs: {release: 'yes'}})
        .where(eq(jobs.id, build.id));
      const deployExecution = await getFirstJobExecutionByJobId(deploy.id);
      if (!deployExecution) throw new Error('Expected deploy job execution');
      await updateJobExecutionStatus({
        jobExecutionId: deployExecution.id,
        status: 'succeeded',
        expectedVersion: deployExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: deploy.id});

      expect(resolved.status).toBe('succeeded');
      expect(
        (await getJobsByWorkflowRunId(run.id)).find((job) => job.id === deploy.id),
      ).toMatchObject({
        status: 'succeeded',
        statusReason: null,
      });
    });

    test('fails closed when the success expression throws at runtime', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            build: {
              success: 'executions.all(e, 1 / 0 == 0)',
              steps: [{run: 'npm test'}],
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
      const job = (await getJobsByWorkflowRunId(run.id))[0];
      if (!job) throw new Error('Expected workflow job');
      const jobExecution = await getFirstJobExecutionByJobId(job.id);
      if (!jobExecution) throw new Error('Expected workflow job execution');
      await updateJobExecutionStatus({
        jobExecutionId: jobExecution.id,
        status: 'succeeded',
        expectedVersion: jobExecution.version,
      });

      const resolved = await resolveJobStatusFromJobExecutions({jobId: job.id});
      const resolvedJob = (await getJobsByWorkflowRunId(run.id))[0];

      expect(resolved.status).toBe('failed');
      expect(resolvedJob).toMatchObject({
        status: 'failed',
        statusReason: 'unknown',
        evaluationTrace: [
          {
            expression: 'executions.all(e, 1 / 0 == 0)',
            roots: ['executions'],
            fillTarget: 'job-resolution',
            evaluatedAt: 'job-resolution',
            value: 'false',
            degraded: true,
            field: 'job.success',
          },
        ],
      });
    });
  });

  describe('updateJobStatus', () => {
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
      const runJobs = await getJobsByWorkflowRunId(run.id);
      const job = runJobs[0];
      expect(job).toBeDefined();

      const updated = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(updated.status).toBe('running');
      expect(updated.version).toBe(2);
    });

    test('rejects status reasons outside the database enum', async () => {
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

      const writeInvalidReason = db().execute(
        sql`UPDATE ${jobs} SET status_reason = 'not_a_reason' WHERE id = ${job?.id}`,
      );

      await expect(writeInvalidReason).rejects.toMatchObject({
        cause: expect.objectContaining({code: '22P02'}),
      });
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
      const runJobs = await getJobsByWorkflowRunId(run.id);

      await expect(
        updateJobStatus({jobId: runJobs[0]?.id ?? '', status: 'running', expectedVersion: 99}),
      ).rejects.toThrow('Optimistic lock failure');
    });

    test('idempotent on retry: re-applying the same transition at the old version is a no-op', async () => {
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
      const first = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      // Simulates a lost Temporal activity result: the row already moved to the
      // requested status at version 2, so the retried expected-version-1 UPDATE
      // matches 0 rows but must return the existing row, not throw.
      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('running');
      expect(retry.version).toBe(first.version);
    });

    test('terminal-tolerant mismatch: existing terminal job returns without re-emitting', async () => {
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
      const cancelled = await updateJobStatus({
        jobId: job?.id as string,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: 1,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect(await jobTerminatedEvents(job?.id as string)).toHaveLength(1);
    });

    test('terminal-tolerant match: existing terminal job cannot be revived at the current version', async () => {
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
      const cancelled = await updateJobStatus({
        jobId: job?.id as string,
        status: 'cancelled',
        expectedVersion: 1,
      });

      const retry = await updateJobStatus({
        jobId: job?.id as string,
        status: 'running',
        expectedVersion: cancelled.version,
      });

      expect(retry.status).toBe('cancelled');
      expect(retry.version).toBe(cancelled.version);
      expect((await getJobsByWorkflowRunId(run.id))[0]).toMatchObject({
        status: 'cancelled',
        version: cancelled.version,
      });
      expect(await jobTerminatedEvents(job?.id as string)).toHaveLength(1);
    });
  });

  describe('job terminal event (WORKFLOWS_JOB_TERMINATED)', () => {
    async function seedPendingJob() {
      const run = await createTestRun({workspaceId, projectId, definitionId});
      const jobId = (await getJobsByWorkflowRunId(run.id))[0]?.id as string;
      const execution = await getFirstJobExecutionByJobId(jobId);
      return {run, jobId, jobExecutionId: execution?.id};
    }

    test.each([
      'succeeded',
      'failed',
      'cancelled',
      'skipped',
    ] as const)('writes one terminated event when a job becomes %s', async (status) => {
      const {run, jobId, jobExecutionId} = await seedPendingJob();

      await updateJobStatus({jobId, status, expectedVersion: 1});

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        jobExecutionId,
        workflowRunId: run.id,
        status,
        statusReason: null,
      });
    });

    test('writes status reason on the terminated event', async () => {
      const {run, jobId} = await seedPendingJob();

      await updateJobStatus({
        jobId,
        status: 'skipped',
        expectedVersion: 1,
        statusReason: 'dependency_not_completed',
      });

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        workflowRunId: run.id,
        status: 'skipped',
        statusReason: 'dependency_not_completed',
      });
    });

    test('writes execution failure details on the terminated event', async () => {
      const {run, jobId, jobExecutionId} = await seedPendingJob();
      const statusReasonMessage =
        'Job output "payload" exceeds the per-value size limit of 65536 bytes (measured 65537 bytes; overshoot 1 bytes).';

      await updateJobExecutionStatus({
        jobExecutionId: jobExecutionId as string,
        status: 'failed',
        expectedVersion: 1,
        statusReason: 'output_too_large',
        statusReasonMessage,
      });
      await updateJobStatus({
        jobId,
        status: 'failed',
        expectedVersion: 1,
        statusReason: 'output_too_large',
      });

      const events = await jobTerminatedEvents(jobId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        jobId,
        workflowRunId: run.id,
        status: 'failed',
        statusReason: 'output_too_large',
        statusReasonMessage,
      });
    });

    test('writes no terminated event for a non-terminal transition', async () => {
      const {jobId} = await seedPendingJob();

      await updateJobStatus({jobId, status: 'running', expectedVersion: 1});

      expect(await jobTerminatedEvents(jobId)).toHaveLength(0);
    });

    test('idempotent retry: a second terminal update at the stale version emits once', async () => {
      const {jobId} = await seedPendingJob();

      const first = await updateJobStatus({jobId, status: 'succeeded', expectedVersion: 1});
      const retry = await updateJobStatus({jobId, status: 'succeeded', expectedVersion: 1});

      expect(retry.version).toBe(first.version);
      expect(await jobTerminatedEvents(jobId)).toHaveLength(1);
    });
  });
});
