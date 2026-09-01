import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {compactedTailObjectKey, deleteObject, listObjectKeys} from '#api/object-storage.js';
import {config} from '#config.js';
import type {AttemptStream} from '#core/entities/attempt-stream.js';
import {logObjectKey} from '#core/entities/log-object.js';
import {listStaleCompactedStreams, listStaleUncompactedStreams} from '#db/streams.js';
import {LOGS_COMPACTION_TASK_QUEUE} from '#temporal/constants.js';

// Bounded per tick; remaining stale streams are picked up on the next cron run.
const RECONCILE_BATCH_LIMIT = 100;

/**
 * Backstop for the event-triggered path: finds closed streams that never got an object
 * key past the stale window and re-starts compaction for each. It also reaps temporary sibling
 * objects for old streams whose winner is already durable. Starting by the same
 * `logs-compact:{streamId}` workflow id re-drives a stream whose bounded-retry run already
 * failed and closed, while skipping one whose run is still RUNNING (AlreadyStarted). Starts
 * independent workflows, not children, so a re-driven run is not tied to this cron tick.
 *
 * One stream's unexpected start or cleanup failure is logged and skipped, never thrown: a single
 * poison stream must not abort the batch and leave the rest of the backlog un-re-driven (the
 * next tick retries it). The activity only fails when it cannot load either batch.
 */
export async function compactionReconcileActivity(): Promise<{
  restarted: number;
  reconciled: number;
  failed: number;
}> {
  const [stale, compacted] = await Promise.all([
    listStaleUncompactedStreams({
      olderThanSeconds: config.LOG_COMPACTION_RECONCILE_STALE_SECONDS,
      limit: RECONCILE_BATCH_LIMIT,
    }),
    listStaleCompactedStreams({
      olderThanSeconds: config.LOG_COMPACTION_RECONCILE_STALE_SECONDS,
      limit: RECONCILE_BATCH_LIMIT,
    }),
  ]);

  let restarted = 0;
  let reconciled = 0;
  let failed = 0;
  for (const stream of stale) {
    try {
      await temporalClient().workflow.start('compactStream', {
        taskQueue: LOGS_COMPACTION_TASK_QUEUE,
        workflowId: `logs-compact:${stream.id}`,
        args: [{streamId: stream.id}],
      });
      restarted += 1;
    } catch (error) {
      if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') continue;
      failed += 1;
      logger().error(
        {err: error, streamId: stream.id},
        'Failed to re-drive stale stream compaction',
      );
      reportError(error, {boundary: 'logs.maintenance', extra: {streamId: stream.id}});
    }
  }

  for (const stream of compacted) {
    try {
      await reconcileCompactedStreamObjects(stream);
      reconciled += 1;
    } catch (error) {
      failed += 1;
      logger().error(
        {err: error, streamId: stream.id},
        'Failed to reconcile compacted log stream objects',
      );
      reportError(error, {boundary: 'logs.maintenance', extra: {streamId: stream.id}});
    }
  }

  return {restarted, reconciled, failed};
}

/**
 * Keeps the published full object and its bounded tail, deleting only sibling attempts. This runs
 * after the winner is durable, so a concurrent loser can finish without ever overwriting the
 * winner; if it finishes after this listing, the next reconcile tick removes it.
 */
async function reconcileCompactedStreamObjects(stream: AttemptStream): Promise<void> {
  if (!stream.objectKey) return;

  const prefix = `${logObjectKey(config.LOG_STORAGE_S3_PREFIX, stream)}/`;
  const retainedKeys = new Set([stream.objectKey, compactedTailObjectKey(stream.objectKey)]);
  const orphanKeys = (await listObjectKeys(prefix)).filter((key) => !retainedKeys.has(key));
  const failures: unknown[] = [];

  for (const key of orphanKeys) {
    try {
      await deleteObject(key);
    } catch (error) {
      failures.push(error);
      logger().error(
        {err: error, streamId: stream.id, objectKey: key},
        'Failed to delete temporary compacted log object',
      );
    }
  }

  if (failures.length > 0) throw failures[0];
}
