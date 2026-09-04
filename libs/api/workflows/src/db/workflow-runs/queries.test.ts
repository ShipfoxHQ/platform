import {WORKFLOW_RUN_JOB_PREVIEW_LIMIT} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {buildModel, createTestRun} from '#test/helpers/workflow-runs.js';
import {db} from '../db.js';
import {jobs} from '../schema/jobs.js';
import {
  createRerunWorkflowRun,
  createWorkflowRun,
  getFirstJobExecutionByJobId,
  getJobsByWorkflowRunId,
  getLatestAttempt,
  getLatestRunAttempt,
  getWorkflowJobExecutionDepth,
  getWorkflowRunById,
  getWorkflowRunLineageHead,
  getWorkflowRunSelection,
  listRunAttempts,
  listRunAttemptsPage,
  listWorkflowRunJobSummaries,
  listWorkflowRuns,
  listWorkflowRunsByProject,
  recordJobExecutionStartedAt,
  updateJobExecutionStatus,
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

  describe('getWorkflowRunById', () => {
    test('returns the run when found', async () => {
      const created = await createWorkflowRun({
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

      const found = await getWorkflowRunById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.status).toBe('pending');
    });

    test('returns undefined when not found', async () => {
      const found = await getWorkflowRunById(crypto.randomUUID());

      expect(found).toBeUndefined();
    });

    test('returns undefined when the workspace does not own the run', async () => {
      const created = await createWorkflowRun({
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

      await expect(getWorkflowRunById(created.id, crypto.randomUUID())).resolves.toBeUndefined();
    });
  });

  describe('getWorkflowRunSelection measurement observer', () => {
    test('does not let a throwing observer change a successful read', async () => {
      const created = await createTestRun({workspaceId, projectId, definitionId});
      const [job] = await getJobsByWorkflowRunId(created.id);
      if (!job) throw new Error('Expected workflow job');
      const onRead = vi.fn(() => {
        throw new Error('observer unavailable');
      });

      await expect(
        getWorkflowRunSelection(
          {
            workflowRunId: created.id,
            projectId,
            query: {job_id: job.id},
          },
          {onRead},
        ),
      ).resolves.toMatchObject({workflowRunId: created.id, jobId: job.id});
      expect(onRead).toHaveBeenCalledTimes(1);
      expect(onRead).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseDurationMilliseconds: expect.any(Number),
          returnedRows: expect.any(Number),
        }),
      );
    });

    test('notifies the observer for a missing identity with zero returned rows', async () => {
      const onRead = vi.fn();

      await expect(
        getWorkflowRunSelection(
          {
            workflowRunId: crypto.randomUUID(),
            projectId,
            query: {job_id: crypto.randomUUID()},
          },
          {onRead},
        ),
      ).resolves.toBeUndefined();
      expect(onRead).toHaveBeenCalledTimes(1);
      expect(onRead).toHaveBeenCalledWith(
        expect.objectContaining({
          databaseDurationMilliseconds: expect.any(Number),
          returnedRows: 0,
        }),
      );
    });
  });

  describe('run attempt lineage queries', () => {
    test('lists run attempts ordered by attempt and returns the latest attempt', async () => {
      const source = await createWorkflowRun({
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
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const second = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      await updateWorkflowRunStatus({
        workflowRunId: second.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const third = await createRerunWorkflowRun({
        workflowRunId: second.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const attempts = await listRunAttempts({workflowRunId: source.id, projectId});
      const latestAttempt = await getLatestAttempt({workflowRunId: source.id, projectId});
      const workspaceLatestAttempt = await getLatestRunAttempt({
        workflowRunId: source.id,
        workspaceId,
      });
      const foreignWorkspaceAttempt = await getLatestRunAttempt({
        workflowRunId: source.id,
        workspaceId: crypto.randomUUID(),
      });

      expect(third.currentAttempt).toBe(3);
      expect(attempts.map((attempt) => attempt.workflowRunId)).toEqual([
        source.id,
        source.id,
        source.id,
      ]);
      expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
      expect(attempts.map((attempt) => attempt.status)).toEqual(['failed', 'failed', 'pending']);
      expect(attempts.map((attempt) => attempt.rerunMode)).toEqual([null, 'all', 'all']);
      expect(latestAttempt).toBe(3);
      expect(workspaceLatestAttempt).toBe(3);
      expect(foreignWorkspaceAttempt).toBeUndefined();
      await expect(
        getLatestRunAttempt({workflowRunId: crypto.randomUUID(), workspaceId}),
      ).resolves.toBeUndefined();
    });

    test('returns a single no-lineage run and filters out another project', async () => {
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
      const otherProjectRun = await createWorkflowRun({
        workspaceId,
        projectId: crypto.randomUUID(),
        definitionId,
        model: buildModel(),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });
      expect(otherProjectRun.projectId).not.toBe(projectId);

      const attempts = await listRunAttempts({workflowRunId: run.id, projectId});

      expect(attempts.map((attempt) => attempt.workflowRunId)).toEqual([run.id]);
    });

    test('pages attempts newest first and keeps a continuation stable after a new attempt', async () => {
      const source = await createWorkflowRun({
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
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const firstPage = await listRunAttemptsPage({
        workflowRunId: source.id,
        projectId,
        limit: 1,
      });

      expect(firstPage.attempts.map((attempt) => attempt.attempt)).toEqual([2]);
      expect(firstPage.nextCursor).not.toBeNull();

      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const secondPage = await listRunAttemptsPage({
        workflowRunId: source.id,
        projectId,
        limit: 1,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(secondPage.attempts.map((attempt) => attempt.attempt)).toEqual([1]);
      expect(secondPage.nextCursor).toBeNull();
    });

    test('reads the lineage head from run and attempt state only', async () => {
      const source = await createWorkflowRun({
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
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });
      const onRead = vi.fn();

      const head = await getWorkflowRunLineageHead(
        {
          workflowRunId: source.id,
          projectId,
        },
        {onRead},
      );

      expect(head).toMatchObject({
        currentAttempt: 2,
        latestAttempt: 2,
        currentStatus: 'pending',
        updatedAt: expect.any(Date),
      });
      expect(onRead).toHaveBeenCalledWith({
        databaseDurationMilliseconds: expect.any(Number),
        returnedRows: 1,
      });
      await expect(
        getWorkflowRunLineageHead({workflowRunId: source.id, projectId: crypto.randomUUID()}),
      ).resolves.toBeUndefined();
    });
  });

  describe('listWorkflowRunJobSummaries', () => {
    test('returns jobs in graph order keyed by run, for many runs at once', async () => {
      const model = buildModel({
        jobs: {
          build: {steps: [{run: 'echo build'}]},
          test: {needs: 'build', steps: [{run: 'echo test'}]},
        },
      });
      const first = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: manualTrigger(),
      });
      const second = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model,
        triggerPayload: manualTrigger(),
      });

      const summaries = await listWorkflowRunJobSummaries([
        {id: first.id, currentAttempt: first.currentAttempt},
        {id: second.id, currentAttempt: second.currentAttempt},
      ]);

      expect(summaries.get(first.id)?.preview.map((job) => job.key)).toEqual(['build', 'test']);
      expect(summaries.get(second.id)?.preview.map((job) => job.key)).toEqual(['build', 'test']);
    });

    test('scopes jobs to the current attempt so a re-run does not stack both attempts', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
        triggerPayload: manualTrigger(),
      });
      const [firstAttemptJob] = await getJobsByWorkflowRunId(source.id);
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      const rerun = await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const summaries = await listWorkflowRunJobSummaries([
        {id: source.id, currentAttempt: rerun.currentAttempt},
      ]);

      expect(rerun.currentAttempt).toBe(2);
      expect(summaries.get(source.id)?.preview.map((job) => job.key)).toEqual(['build']);
      expect(summaries.get(source.id)?.preview[0]?.id).not.toBe(firstAttemptJob?.id);
    });

    // The caller pins the attempt, so a re-run landing after its read still yields the jobs
    // that belong to the metadata it is about to render, not whichever attempt is newest.
    test('returns the caller requested attempt, not whichever is current now', async () => {
      const source = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
        triggerPayload: manualTrigger(),
      });
      const [firstAttemptJob] = await getJobsByWorkflowRunId(source.id);
      await updateWorkflowRunStatus({
        workflowRunId: source.id,
        status: 'failed',
        expectedVersion: 1,
      });
      await createRerunWorkflowRun({
        workflowRunId: source.id,
        mode: 'all',
        actorUserId: crypto.randomUUID(),
      });

      const summaries = await listWorkflowRunJobSummaries([{id: source.id, currentAttempt: 1}]);

      expect(summaries.get(source.id)?.preview[0]?.id).toBe(firstAttemptJob?.id);
    });

    // The row draws a bounded strip, so the query must not hand back one row per job of a
    // workflow that has no job limit; everything past the preview is described by counts.
    test('caps the preview and still counts every job past it', async () => {
      const jobCount = WORKFLOW_RUN_JOB_PREVIEW_LIMIT + 9;
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: Object.fromEntries(
            Array.from({length: jobCount}, (_, index) => [
              `job-${String(index).padStart(2, '0')}`,
              {steps: [{run: `echo ${index}`}]},
            ]),
          ),
        }),
        triggerPayload: manualTrigger(),
      });

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.preview).toHaveLength(WORKFLOW_RUN_JOB_PREVIEW_LIMIT);
      expect(totalOf(summary.get(run.id))).toBe(jobCount);
    });

    test('counts each status the run holds, not only the previewed ones', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {build: {steps: [{run: 'echo build'}]}, test: {steps: [{run: 'echo test'}]}},
        }),
        triggerPayload: manualTrigger(),
      });

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.statusCounts).toEqual([{status: 'pending', count: 2}]);
      expect(summary.get(run.id)?.hasStartedJobExecution).toBe(false);
    });

    test('reports when any current-attempt job execution has started', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
        triggerPayload: manualTrigger(),
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('Expected workflow job');
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('Expected workflow job execution');

      await recordJobExecutionStartedAt({
        jobExecutionId: execution.id,
        startedAt: new Date('2026-05-07T01:00:05.000Z'),
      });

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.hasStartedJobExecution).toBe(true);
    });

    test('returns execution evidence and counts its display status', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
        triggerPayload: manualTrigger(),
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('expected the run to have a job');
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('expected the job to have an execution');

      await updateJobExecutionStatus({
        jobExecutionId: execution.id,
        status: 'running',
        expectedVersion: execution.version,
      });

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.preview).toMatchObject([
        {
          status: 'pending',
          mode: 'one_shot',
          listenerStatus: 'inactive',
          executionStatus: 'running',
        },
      ]);
      expect(summary.get(run.id)?.statusCounts).toEqual([{status: 'running', count: 1}]);
      expect(summary.get(run.id)?.rawStatusCounts).toEqual([{status: 'pending', count: 1}]);
    });

    test('counts an active listener without an execution', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            listen: {
              listening: {
                on: [{source: 'github', event: 'push'}],
                onResolve: 'finish',
              },
              steps: [{run: 'echo listen'}],
            },
          },
        }),
        triggerPayload: manualTrigger(),
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('expected the run to have a listener job');

      await db().update(jobs).set({listenerStatus: 'listening'}).where(eq(jobs.id, job.id));

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.preview).toMatchObject([
        {
          mode: 'listening',
          listenerStatus: 'listening',
          executionStatus: null,
        },
      ]);
      expect(summary.get(run.id)?.statusCounts).toEqual([{status: 'listening', count: 1}]);
      expect(summary.get(run.id)?.rawStatusCounts).toEqual([{status: 'pending', count: 1}]);
    });

    test('keeps a terminal verdict ahead of a running execution', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({jobs: {build: {steps: [{run: 'echo build'}]}}}),
        triggerPayload: manualTrigger(),
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('expected the run to have a job');
      const execution = await getFirstJobExecutionByJobId(job.id);
      if (!execution) throw new Error('expected the job to have an execution');

      await updateJobExecutionStatus({
        jobExecutionId: execution.id,
        status: 'running',
        expectedVersion: execution.version,
      });
      await updateJobStatus({jobId: job.id, status: 'failed', expectedVersion: job.version});

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.preview).toMatchObject([
        {status: 'failed', executionStatus: 'running'},
      ]);
      expect(summary.get(run.id)?.statusCounts).toEqual([{status: 'failed', count: 1}]);
      expect(summary.get(run.id)?.rawStatusCounts).toEqual([{status: 'failed', count: 1}]);
    });

    test('counts a skipped zero-execution job from its terminal verdict', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            listen: {
              listening: {
                on: [{source: 'github', event: 'push'}],
                onResolve: 'finish',
              },
              steps: [{run: 'echo listen'}],
            },
          },
        }),
        triggerPayload: manualTrigger(),
      });
      const [job] = await getJobsByWorkflowRunId(run.id);
      if (!job) throw new Error('expected the run to have a listener job');

      await db()
        .update(jobs)
        .set({status: 'skipped', listenerStatus: 'resolved'})
        .where(eq(jobs.id, job.id));

      const summary = await listWorkflowRunJobSummaries([
        {id: run.id, currentAttempt: run.currentAttempt},
      ]);

      expect(summary.get(run.id)?.preview).toMatchObject([
        {status: 'skipped', executionStatus: null},
      ]);
      expect(summary.get(run.id)?.statusCounts).toEqual([{status: 'skipped', count: 1}]);
      expect(summary.get(run.id)?.rawStatusCounts).toEqual([{status: 'skipped', count: 1}]);
    });

    // Checks the invariant the snapshot exists to protect: for a run inside the preview
    // bound, the statuses drawn and the statuses counted describe the same jobs and must
    // agree exactly. The read races a commit to give the anomaly a chance to appear, so this
    // samples rather than proves; the guarantee itself comes from the isolation level, which
    // no assertion here can force an interleaving against.
    test('agrees between preview and counts while a job settles underneath', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {build: {steps: [{run: 'echo build'}]}, test: {steps: [{run: 'echo test'}]}},
        }),
        triggerPayload: manualTrigger(),
      });
      const [firstJob] = await getJobsByWorkflowRunId(run.id);
      if (!firstJob) throw new Error('expected the run to have jobs');

      // Commits a status change while the read is in flight. A snapshot taken per statement
      // would let one half of the answer see it and the other half miss it.
      const settleMidRead = updateJobStatus({
        jobId: firstJob.id,
        status: 'failed',
        expectedVersion: firstJob.version,
      });
      const [summaries] = await Promise.all([
        listWorkflowRunJobSummaries([{id: run.id, currentAttempt: run.currentAttempt}]),
        settleMidRead,
      ]);

      const summary = summaries.get(run.id);
      expect(previewCounts(summary)).toEqual(statusCountMap(summary));
    });

    test('returns an empty map without querying for an empty page', async () => {
      await expect(listWorkflowRunJobSummaries([])).resolves.toEqual(new Map());
    });
  });

  describe('listWorkflowRunsByProject', () => {
    test('returns runs ordered by creation descending', async () => {
      await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({name: 'First'}),
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
        definitionId,
        model: buildModel({name: 'Second'}),
        triggerPayload: {
          source: 'manual',
          event: 'fire',
          subscriptionId: crypto.randomUUID(),
          userId: crypto.randomUUID(),
        },
      });

      const runs = await listWorkflowRunsByProject(projectId);

      expect(runs).toHaveLength(2);
      expect(runs[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        runs[1]?.createdAt.getTime() as number,
      );
    });

    test('returns empty array for unknown project', async () => {
      const runs = await listWorkflowRunsByProject(crypto.randomUUID());

      expect(runs).toEqual([]);
    });
  });

  describe('listWorkflowRuns', () => {
    test('scopes a listing to the requested workspace', async () => {
      await createWorkflowRun({
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

      const result = await listWorkflowRuns({
        workspaceId: crypto.randomUUID(),
        projectId,
        limit: 50,
        includeTotal: true,
      });

      expect(result).toEqual({runs: [], nextCursor: null, filteredTotalCount: 0});
    });
  });

  describe('getJobsByWorkflowRunId', () => {
    test('returns jobs for a run ordered by position', async () => {
      const run = await createWorkflowRun({
        workspaceId,
        projectId,
        definitionId,
        model: buildModel({
          jobs: {
            lint: {steps: [{run: 'lint'}]},
            build: {steps: [{run: 'build'}]},
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

      expect(runJobs).toHaveLength(2);
      expect(runJobs[0]?.position).toBe(0);
      expect(runJobs[1]?.position).toBe(1);
    });
  });

  describe('getWorkflowJobExecutionDepth', () => {
    test('counts running runs and job executions within a workspace', async () => {
      const runningRun = await createTestRun({workspaceId, projectId, definitionId});
      const pendingRun = await createTestRun({workspaceId, projectId, definitionId});
      const otherWorkspaceRun = await createTestRun({
        workspaceId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        definitionId: crypto.randomUUID(),
      });
      const [runningJobExecution] = await getJobsByWorkflowRunId(runningRun.id);
      const [otherWorkspaceJob] = await getJobsByWorkflowRunId(otherWorkspaceRun.id);
      if (!runningJobExecution || !otherWorkspaceJob) throw new Error('Expected workflow jobs');
      const runningExecution = await getFirstJobExecutionByJobId(runningJobExecution.id);
      const otherWorkspaceExecution = await getFirstJobExecutionByJobId(otherWorkspaceJob.id);
      if (!runningExecution || !otherWorkspaceExecution) {
        throw new Error('Expected workflow job executions');
      }
      await updateWorkflowRunStatus({
        workflowRunId: runningRun.id,
        status: 'running',
        expectedVersion: runningRun.version,
      });
      await updateWorkflowRunStatus({
        workflowRunId: otherWorkspaceRun.id,
        status: 'running',
        expectedVersion: otherWorkspaceRun.version,
      });
      await updateJobExecutionStatus({
        jobExecutionId: runningExecution.id,
        status: 'running',
        expectedVersion: runningExecution.version,
      });
      await updateJobExecutionStatus({
        jobExecutionId: otherWorkspaceExecution.id,
        status: 'running',
        expectedVersion: otherWorkspaceExecution.version,
      });

      const depth = await getWorkflowJobExecutionDepth({workspaceId});

      expect(pendingRun.status).toBe('pending');
      expect(depth).toEqual({
        runningRuns: 1,
        runningJobExecutions: 1,
      });
    });
  });
});

function manualTrigger() {
  return {
    source: 'manual',
    event: 'fire',
    subscriptionId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  } as const;
}

function totalOf(summary: {statusCounts: Array<{count: number}>} | undefined): number {
  return (summary?.statusCounts ?? []).reduce((total, entry) => total + entry.count, 0);
}

/** Statuses the preview actually drew, counted. */
function previewCounts(
  summary:
    | {
        preview: Array<{
          status: string;
          mode: string;
          listenerStatus: string;
          executionStatus: string | null;
        }>;
      }
    | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of summary?.preview ?? []) {
    const status = previewDisplayStatus(job);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function previewDisplayStatus(job: {
  status: string;
  mode: string;
  listenerStatus: string;
  executionStatus: string | null;
}): string {
  if (['succeeded', 'failed', 'cancelled', 'skipped'].includes(job.status)) return job.status;
  if (job.mode === 'listening' && job.listenerStatus === 'listening') return 'listening';
  return job.executionStatus ?? 'pending';
}

/** The same shape read off the totals, so the two halves can be compared directly. */
function statusCountMap(
  summary: {statusCounts: Array<{status: string; count: number}>} | undefined,
): Record<string, number> {
  return Object.fromEntries(
    (summary?.statusCounts ?? []).map(({status, count}) => [status, count]),
  );
}
