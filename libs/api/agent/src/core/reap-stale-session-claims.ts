import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {listStaleClaimedSessions, releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';

export interface ReapStaleSessionClaimsResult {
  /** Claims cleared by this run. */
  reaped: number;
  /** Rows whose guarded release threw; logged, skipped, retried next run. */
  failed: number;
}

export interface ReapStaleSessionClaimsParams {
  /**
   * A claim held longer than this since `claimed_at` can no longer be live:
   * its job holds one lease minted at-or-before the claim, so once the lease
   * TTL has elapsed no step of that job can still run. Set above the Auth job
   * lease lifetime.
   */
  olderThanSeconds: number;
  batchLimit: number;
}

/**
 * Cron-driven backstop that releases session claims the one-shot termination
 * paths missed: a wedged runner, a lost step-attempt-terminated event, or a
 * job-terminated sweep that ran before the claim landed. Mirrors the logs
 * stale-stream reaper; each row releases in its own guarded statement, so a
 * tick/retry overlap is idempotent (a claim another attempt already took is
 * untouched) and one failed row is logged and skipped instead of aborting the
 * batch.
 */
export async function reapStaleSessionClaims(
  params: ReapStaleSessionClaimsParams,
): Promise<ReapStaleSessionClaimsResult> {
  const stale = await listStaleClaimedSessions({
    olderThanSeconds: params.olderThanSeconds,
    limit: params.batchLimit,
  });

  const result: ReapStaleSessionClaimsResult = {reaped: 0, failed: 0};
  for (const session of stale) {
    try {
      if (!session.claimedByStepAttempt) continue;
      const released = await releaseSessionClaimsHeldByStepAttempts([session.claimedByStepAttempt]);
      if (released > 0) result.reaped += 1;
    } catch (error) {
      result.failed += 1;
      logger().error(
        {err: error, sessionId: session.id, key: session.key},
        'Failed to reap stale agent session claim',
      );
      reportError(error, {
        boundary: 'agent.maintenance',
        extra: {sessionId: session.id, key: session.key},
      });
    }
  }

  return result;
}
