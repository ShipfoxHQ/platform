import {Buffer} from 'node:buffer';
import {eq, sql} from 'drizzle-orm';
import {
  compactedTailObjectKey,
  deleteObject,
  listObjectKeys,
  putObjectBytes,
} from '#api/object-storage.js';
import {config} from '#config.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {db} from '#db/db.js';
import {attemptStreams} from '#db/schema/attempt-streams.js';
import {listStaleCompactedStreams} from '#db/streams.js';
import {LOGS_COMPACTION_TASK_QUEUE} from '#temporal/constants.js';
import {arrangeClosedStream, type ClosedStreamIdentity} from '#test/fixtures/closed-stream.js';
import {ndjsonBody, outputLine} from '#test/fixtures/ndjson.js';
import {compactionReconcileActivity} from './compaction-reconcile.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function newIdentity(): ClosedStreamIdentity {
  return {
    jobId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
  };
}

function attemptPrefix(identity: ClosedStreamIdentity): string {
  return `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, identity)}/`;
}

async function backdateClosedAt(streamId: string): Promise<void> {
  await db()
    .update(attemptStreams)
    .set({
      closedAt: sql`now() - interval '1 hour'`,
      updatedAt: sql`now() - interval '1 hour'`,
    })
    .where(eq(attemptStreams.id, streamId));
}

async function markCompacted(streamId: string): Promise<void> {
  await db()
    .update(attemptStreams)
    .set({objectKey: `logs/test/${streamId}`})
    .where(eq(attemptStreams.id, streamId));
}

function alreadyStartedError(): Error {
  const error = new Error('Workflow execution already started');
  error.name = 'WorkflowExecutionAlreadyStartedError';
  return error;
}

describe('compactionReconcileActivity', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('re-starts compaction for a closed, uncompacted stream past the stale window', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    await backdateClosedAt(stream.id);

    await compactionReconcileActivity();

    expect(startMock).toHaveBeenCalledWith('compactStream', {
      taskQueue: LOGS_COMPACTION_TASK_QUEUE,
      workflowId: `logs-compact:${stream.id}`,
      args: [{streamId: stream.id}],
    });
  });

  it('does not re-start a stream closed too recently to be stale', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });

    await compactionReconcileActivity();

    expect(startMock).not.toHaveBeenCalledWith(
      'compactStream',
      expect.objectContaining({workflowId: `logs-compact:${stream.id}`}),
    );
  });

  it('does not re-start an already-compacted stream', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    await backdateClosedAt(stream.id);
    await markCompacted(stream.id);

    await compactionReconcileActivity();

    expect(startMock).not.toHaveBeenCalledWith(
      'compactStream',
      expect.objectContaining({workflowId: `logs-compact:${stream.id}`}),
    );
  });

  it('reconciles temporary siblings after a compacted winner is durable', async () => {
    const identity = newIdentity();
    const stream = await arrangeClosedStream(identity, {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    const prefix = attemptPrefix(identity);
    const winner = `${prefix}winner`;
    const winnerTail = compactedTailObjectKey(winner);
    const orphan = `${prefix}orphan`;
    const orphanTail = compactedTailObjectKey(orphan);
    await putObjectBytes(winner, Buffer.from('winner'));
    await putObjectBytes(winnerTail, Buffer.from('winner tail'));
    await putObjectBytes(orphan, Buffer.from('orphan'));
    await putObjectBytes(orphanTail, Buffer.from('orphan tail'));
    await db()
      .update(attemptStreams)
      .set({objectKey: winner})
      .where(eq(attemptStreams.id, stream.id));
    await backdateClosedAt(stream.id);

    const result = await compactionReconcileActivity();

    expect(result.reconciled).toBeGreaterThanOrEqual(1);
    expect(await listObjectKeys(prefix)).toEqual([winner, winnerTail]);
    expect(
      (
        await listStaleCompactedStreams({
          olderThanSeconds: config.LOG_COMPACTION_RECONCILE_STALE_SECONDS,
          limit: 100,
        })
      ).some(({id}) => id === stream.id),
    ).toBe(false);
    await deleteObject(winner);
    await deleteObject(winnerTail);
  });

  it('swallows an already-started workflow so a still-running compaction is left alone', async () => {
    const stream = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('x\n'))],
    });
    await backdateClosedAt(stream.id);
    startMock.mockRejectedValue(alreadyStartedError());

    await expect(compactionReconcileActivity()).resolves.toEqual(
      expect.objectContaining({restarted: expect.any(Number)}),
    );
  });

  it('logs and skips one stream whose start fails, still re-driving the rest of the batch', async () => {
    const poison = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('a\n'))],
    });
    const healthy = await arrangeClosedStream(newIdentity(), {
      chunks: [ndjsonBody(outputLine('b\n'))],
    });
    // Poison sorts first (oldest closed_at); if the loop aborted on its failure, healthy would
    // never be attempted, which is exactly the regression this guards.
    await db()
      .update(attemptStreams)
      .set({closedAt: sql`now() - interval '2 hours'`})
      .where(eq(attemptStreams.id, poison.id));
    await backdateClosedAt(healthy.id);
    startMock.mockImplementation((_name, opts) =>
      opts.workflowId === `logs-compact:${poison.id}`
        ? Promise.reject(new Error('temporal namespace rate-limited'))
        : Promise.resolve({}),
    );

    const result = await compactionReconcileActivity();

    expect(startMock).toHaveBeenCalledWith(
      'compactStream',
      expect.objectContaining({workflowId: `logs-compact:${poison.id}`}),
    );
    expect(startMock).toHaveBeenCalledWith(
      'compactStream',
      expect.objectContaining({workflowId: `logs-compact:${healthy.id}`}),
    );
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});
