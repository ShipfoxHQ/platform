import {config, isUnsafeReapAfterSeconds, resolveReapBatchLimit} from '#config.js';
import {
  type ReapStaleSessionClaimsResult,
  reapStaleSessionClaims,
} from '#core/reap-stale-session-claims.js';

/**
 * Cron-driven backstop that releases claims the one-shot termination paths
 * missed. When `AGENT_SESSION_REAP_AFTER_SECONDS` is unsafe (non-finite,
 * non-positive, or at or below the configured maximum job execution duration)
 * the destructive sweep is disabled: force-releasing with such a threshold
 * would clear claims a still-running step legitimately holds. The unsafe-config
 * warning is emitted once at module creation (`warnOnUnsafeAgentSessionConfig`),
 * so this activity stays silent instead of repeating it on every cron tick.
 */
export async function reapStaleSessionClaimsActivity(): Promise<ReapStaleSessionClaimsResult> {
  if (isUnsafeReapAfterSeconds()) {
    return {reaped: 0, failed: 0};
  }

  return await reapStaleSessionClaims({
    olderThanSeconds: config.AGENT_SESSION_REAP_AFTER_SECONDS,
    batchLimit: resolveReapBatchLimit(),
  });
}
