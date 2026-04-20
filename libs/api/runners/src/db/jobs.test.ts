import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import {sql} from 'drizzle-orm';
import {pendingJobFactory, runnerTokenFactory} from '#test/index.js';
import {db} from './db.js';
import {claimJob, completeJob, enqueueJob} from './jobs.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

describe('enqueueJob', () => {
  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_outbox CASCADE`,
    );
  });

  it('inserts a row into pending_jobs with correct payload', async () => {
    const jobId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const payload = {
      job_id: jobId,
      run_id: runId,
      job_name: 'build',
      steps: [
        {
          id: crypto.randomUUID(),
          name: 'hello',
          type: 'run',
          config: {run: 'echo hello'},
          position: 0,
        },
      ],
    };

    await enqueueJob({workspaceId, jobId, runId, payload});

    const rows = await db().select().from(pendingJobs);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.jobId).toBe(jobId);
    expect(rows[0]?.runId).toBe(runId);
    expect(rows[0]?.workspaceId).toBe(workspaceId);
    expect(rows[0]?.payload).toEqual(payload);
  });

  it('throws on duplicate job_id', async () => {
    const jobId = crypto.randomUUID();
    const attrs = {workspaceId: crypto.randomUUID(), runId: crypto.randomUUID(), jobId};
    const payload = {job_id: jobId, run_id: attrs.runId, job_name: 'build', steps: []};

    await enqueueJob({...attrs, payload});

    await expect(enqueueJob({...attrs, payload})).rejects.toThrow();
  });
});

describe('claimJob', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('returns the job payload when a job is available', async () => {
    const created = await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).not.toBeNull();
    expect(claimed?.jobId).toBe(created.jobId);
    expect(claimed?.runId).toBe(created.runId);
    expect(claimed?.payload.job_name).toBe(created.payload.job_name);
  });

  it('returns null when no jobs are pending', async () => {
    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });

  it('only one caller wins when two claim concurrently', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const [claim1, claim2] = await Promise.all([
      claimJob({workspaceId, runnerTokenId}),
      claimJob({workspaceId, runnerTokenId: otherRunnerToken.id}),
    ]);

    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it('claims the oldest job first', async () => {
    const older = await pendingJobFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed?.jobId).toBe(older.jobId);
  });

  it('moves the job from pending to running', async () => {
    await pendingJobFactory.create({workspaceId});

    await claimJob({workspaceId, runnerTokenId});

    const pending = await db().select().from(pendingJobs);
    const running = await db().select().from(runningJobs);
    expect(pending).toHaveLength(0);
    expect(running).toHaveLength(1);
    expect(running[0]?.runnerTokenId).toBe(runnerTokenId);
  });

  it('does not claim jobs from another workspace', async () => {
    await pendingJobFactory.create({workspaceId: crypto.randomUUID()});

    const claimed = await claimJob({workspaceId, runnerTokenId});

    expect(claimed).toBeNull();
  });
});

describe('completeJob', () => {
  let workspaceId: string;
  let runnerTokenId: string;

  beforeEach(async () => {
    await db().execute(
      sql`TRUNCATE runners_pending_jobs, runners_running_jobs, runners_runner_tokens, runners_outbox CASCADE`,
    );
    workspaceId = crypto.randomUUID();
    const runnerToken = await runnerTokenFactory.create({workspaceId});
    runnerTokenId = runnerToken.id;
  });

  it('deletes the running job and writes an outbox event', async () => {
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

    const result = await completeJob(
      {jobId: claimed?.jobId as string, runnerTokenId},
      {status: 'succeeded'},
    );

    expect(result.runId).toBe(claimed?.runId as string);

    const running = await db().select().from(runningJobs);
    expect(running).toHaveLength(0);

    const outboxRows = await db().select().from(runnersOutbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(RUNNER_JOB_COMPLETED);
    const payload = outboxRows[0]?.payload as Record<string, unknown>;
    expect(payload.jobId).toBe(claimed?.jobId as string);
    expect(payload.runId).toBe(claimed?.runId as string);
    expect(payload.status).toBe('succeeded');
  });

  it('throws RunningJobNotFoundError when job is not running', async () => {
    await expect(
      completeJob({jobId: crypto.randomUUID(), runnerTokenId}, {status: 'succeeded'}),
    ).rejects.toThrow('Running job not found');
  });

  it('does not complete a job owned by another runner token', async () => {
    const otherRunnerToken = await runnerTokenFactory.create({workspaceId});
    await pendingJobFactory.create({workspaceId});
    const claimed = await claimJob({workspaceId, runnerTokenId});

    await expect(
      completeJob(
        {jobId: claimed?.jobId as string, runnerTokenId: otherRunnerToken.id},
        {status: 'succeeded'},
      ),
    ).rejects.toThrow('Running job not found');

    const running = await db().select().from(runningJobs);
    const outboxRows = await db().select().from(runnersOutbox);
    expect(running).toHaveLength(1);
    expect(outboxRows).toHaveLength(0);
  });
});
