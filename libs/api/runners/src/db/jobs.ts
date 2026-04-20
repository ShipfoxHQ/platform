import {
  type JobPayloadDto,
  RUNNER_JOB_COMPLETED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, sql} from 'drizzle-orm';
import {RunningJobNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {runnersOutbox} from './schema/outbox.js';
import {pendingJobs} from './schema/pending-jobs.js';
import {runningJobs} from './schema/running-jobs.js';

export interface EnqueueJobParams {
  workspaceId: string;
  jobId: string;
  runId: string;
  payload: JobPayloadDto;
}

export async function enqueueJob(params: EnqueueJobParams): Promise<void> {
  await db().insert(pendingJobs).values({
    workspaceId: params.workspaceId,
    jobId: params.jobId,
    runId: params.runId,
    payload: params.payload,
  });
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
  payload: JobPayloadDto;
}

export async function claimJob(params: {
  workspaceId: string;
  runnerTokenId: string;
}): Promise<ClaimedJob | null> {
  return await db().transaction(async (tx) => {
    const rows = await tx.execute(
      sql`SELECT id, workspace_id, job_id, run_id, payload
          FROM runners_pending_jobs
          WHERE workspace_id = ${params.workspaceId}
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
    );

    const row = rows.rows[0] as
      | {id: string; workspace_id: string; job_id: string; run_id: string; payload: unknown}
      | undefined;

    if (!row) return null;

    await tx.delete(pendingJobs).where(eq(pendingJobs.id, row.id));

    await tx.insert(runningJobs).values({
      workspaceId: row.workspace_id,
      jobId: row.job_id,
      runId: row.run_id,
      runnerTokenId: params.runnerTokenId,
    });

    return {
      jobId: row.job_id,
      runId: row.run_id,
      payload: row.payload as JobPayloadDto,
    };
  });
}

export async function completeJob(
  params: {jobId: string; runnerTokenId: string},
  result: {status: 'succeeded' | 'failed'; output?: unknown},
): Promise<{runId: string}> {
  return await db().transaction(async (tx) => {
    const rows = await tx
      .select({runId: runningJobs.runId})
      .from(runningJobs)
      .where(
        and(
          eq(runningJobs.jobId, params.jobId),
          eq(runningJobs.runnerTokenId, params.runnerTokenId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new RunningJobNotFoundError(params.jobId);

    await tx
      .delete(runningJobs)
      .where(
        and(
          eq(runningJobs.jobId, params.jobId),
          eq(runningJobs.runnerTokenId, params.runnerTokenId),
        ),
      );

    await writeOutboxEvent<RunnersEventMap>(tx, runnersOutbox, {
      type: RUNNER_JOB_COMPLETED,
      payload: {
        jobId: params.jobId,
        runId: row.runId,
        status: result.status,
        output: result.output,
      },
    });

    return {runId: row.runId};
  });
}
