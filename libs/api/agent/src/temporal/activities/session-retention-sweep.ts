import {Context} from '@temporalio/activity';
import {config} from '#config.js';
import {
  runSessionRetentionSweep,
  type SessionRetentionSweepResult,
} from '#core/session-retention.js';
import {
  SESSION_RETENTION_BATCH_LIMIT,
  SESSION_RETENTION_MAX_ITERATIONS,
  SESSION_RETENTION_TIME_BUDGET_MS,
} from '#temporal/constants.js';

/**
 * Cron-driven sweep for expired session rows and superseded or orphaned
 * transcript segments. Heartbeats per session; the core loop owns the
 * wall-clock budget because Temporal timeouts do not stop already-running JS.
 */
export function sessionRetentionSweepActivity(): Promise<SessionRetentionSweepResult> {
  const ctx = Context.current();
  return runSessionRetentionSweep({
    retentionDays: config.AGENT_SESSION_RETENTION_DAYS,
    segmentGraceSeconds: config.AGENT_SESSION_SEGMENT_GRACE_SECONDS,
    batchLimit: SESSION_RETENTION_BATCH_LIMIT,
    timeBudgetMs: SESSION_RETENTION_TIME_BUDGET_MS,
    maxIterations: SESSION_RETENTION_MAX_ITERATIONS,
    onProgress: () => ctx.heartbeat(),
  });
}
