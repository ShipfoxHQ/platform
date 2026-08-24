import {config} from '#config.js';
import {
  type ReapStaleSessionClaimsResult,
  reapStaleSessionClaims,
} from '#core/reap-stale-session-claims.js';
import {AGENT_SESSION_REAP_BATCH_LIMIT} from '#temporal/constants.js';

/** Cron-driven backstop that releases claims the one-shot termination paths missed. */
export function reapStaleSessionClaimsActivity(): Promise<ReapStaleSessionClaimsResult> {
  return reapStaleSessionClaims({
    olderThanSeconds: config.AGENT_SESSION_REAP_AFTER_SECONDS,
    batchLimit: AGENT_SESSION_REAP_BATCH_LIMIT,
  });
}
