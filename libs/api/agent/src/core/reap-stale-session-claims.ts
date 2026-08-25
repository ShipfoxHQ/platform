import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {listStaleClaimedSessions, releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';
import {sessionClaimReapFailedCount, sessionClaimReleaseCount} from '#metrics/instance.js';

export interface ReapStaleSessionClaimsResult {
  /** Claims cleared by this run (a wedged attempt holding several counts each). */
  reaped: number;
  /** Distinct step attempts whose guarded release threw; logged, skipped, retried next run. */
  failed: number;
}

export interface ReapStaleSessionClaimsParams {
  /**
   * A claim held longer than this since `claimed_at` is treated as abandoned.
   * This is a backstop heuristic, not a liveness signal: the runner re-mints its
   * job lease on every heartbeat and executions run up to their configured
   * maximum duration, so `olderThanSeconds` must exceed the longest job
   * execution duration for the deployment. Set via `AGENT_SESSION_REAP_AFTER_SECONDS`.
   */
  olderThanSeconds: number;
  batchLimit: number;
}

/**
 * Cron-driven backstop that releases session claims the one-shot termination
 * paths missed: a wedged runner, a lost step-attempt-terminated event, or a
 * job-terminated sweep that ran before the claim landed. Distinct claiming
 * attempts are deduped (a wedged attempt's many stale claims release
 * together) and each releases in its own guarded statement, so a tick/retry
 * overlap is idempotent (a claim another attempt already took is untouched)
 * and one failed attempt is logged and skipped instead of aborting the batch.
 * Releases are guarded on the stale cutoff itself, so a live (fresh) claim
 * held by an attempt that also holds stale claims is never swept with them.
 * `reaped` sums the actual claims cleared.
 */
export async function reapStaleSessionClaims(
  params: ReapStaleSessionClaimsParams,
): Promise<ReapStaleSessionClaimsResult> {
  const stale = await listStaleClaimedSessions({
    olderThanSeconds: params.olderThanSeconds,
    limit: params.batchLimit,
  });

  const result: ReapStaleSessionClaimsResult = {reaped: 0, failed: 0};
  const distinctAttemptIds = new Set<string>();
  for (const session of stale) {
    if (session.claimedByStepAttempt) distinctAttemptIds.add(session.claimedByStepAttempt);
  }

  for (const stepAttemptId of distinctAttemptIds) {
    try {
      const released = await releaseSessionClaimsHeldByStepAttempts([stepAttemptId], {
        olderThanSeconds: params.olderThanSeconds,
      });
      if (released > 0) {
        result.reaped += released;
        sessionClaimReleaseCount.add(released, {path: 'reap'});
      }
    } catch (error) {
      result.failed += 1;
      sessionClaimReapFailedCount.add(1);
      logger().error({err: error, stepAttemptId}, 'Failed to reap stale agent session claim');
      reportError(error, {
        boundary: 'agent.maintenance',
        extra: {stepAttemptId},
      });
    }
  }

  return result;
}
