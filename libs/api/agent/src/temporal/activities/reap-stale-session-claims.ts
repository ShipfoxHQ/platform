import {logger} from '@shipfox/node-opentelemetry';
import {config, isUnsafeReapAfterSeconds, resolveReapBatchLimit} from '#config.js';
import {
  type ReapStaleSessionClaimsResult,
  reapStaleSessionClaims,
} from '#core/reap-stale-session-claims.js';

/**
 * Cron-driven backstop that releases claims the one-shot termination paths
 * missed. When `AGENT_SESSION_REAP_AFTER_SECONDS` is unsafe (non-finite,
 * non-positive, or at or below the workflows default maximum execution
 * duration) the destructive sweep is disabled: a warning was already logged at
 * module creation, and force-releasing with such a threshold would clear
 * claims a still-running step legitimately holds.
 */
export async function reapStaleSessionClaimsActivity(): Promise<ReapStaleSessionClaimsResult> {
  if (isUnsafeReapAfterSeconds()) {
    logger().warn(
      {reapAfterSeconds: config.AGENT_SESSION_REAP_AFTER_SECONDS},
      'Skipping the stale agent session claim reap: AGENT_SESSION_REAP_AFTER_SECONDS is not a positive number above the longest job execution duration, so the sweep would risk releasing live claims.',
    );
    return {reaped: 0, failed: 0};
  }

  return await reapStaleSessionClaims({
    olderThanSeconds: config.AGENT_SESSION_REAP_AFTER_SECONDS,
    batchLimit: resolveReapBatchLimit(),
  });
}
