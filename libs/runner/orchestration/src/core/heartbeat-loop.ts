import {logger} from '@shipfox/node-opentelemetry';
import {HTTPError, heartbeat} from '@shipfox/runner-protocol';

type HeartbeatCapabilities = NonNullable<Parameters<typeof heartbeat>[2]>['capabilities'];

export interface HeartbeatLoopOptions {
  intervalMs: number;
  /**
   * Max time an in-flight heartbeat HTTP call may stay outstanding before the
   * loop aborts it and schedules the next tick. Bounds overlap to "at most one
   * call in flight" under any API latency.
   */
  maxStaleMs: number;
  getToolCapabilities?: () => HeartbeatCapabilities;
  /** Server-selected maximum time without a successful lease confirmation. */
  isolationTimeoutSeconds?: number;
  /** Monotonic clock, injectable to make the fence deterministic in tests. */
  nowMs?: () => number;
  onLeaseTokenRenewed?: (leaseToken: string) => void;
}

export interface HeartbeatLoopHandle {
  /** Aborts any in-flight heartbeat and clears the pending timer. Idempotent. */
  stop: () => void;
  /** Marks externally adopted lease tokens so stale heartbeat renewals are ignored. */
  bumpGeneration: () => void;
}

/**
 * Single-flight, setTimeout-chained heartbeat scheduler. At most one heartbeat
 * HTTP call is outstanding at any moment: the next tick is scheduled only after
 * the current one resolves, rejects, or is aborted by the max-stale guard.
 *
 *   tick fires → heartbeat resolves before maxStaleMs ──► schedule next tick
 *                heartbeat returns cancel:true ──────────► jobAc.abort(reason); stop
 *                heartbeat returns 404 ──────────────────► jobAc.abort('orphaned');  stop
 *                maxStaleMs elapses ─────────────────────► httpAc.abort(); schedule next tick
 *                other error ────────────────────────────► log warn; schedule next tick
 */
export function startHeartbeatLoop(
  jobId: string,
  getLeaseToken: () => string,
  jobAbortController: AbortController,
  options: HeartbeatLoopOptions,
): HeartbeatLoopHandle {
  let stopped = false;
  let generation = 0;
  let pendingTimer: NodeJS.Timeout | undefined;
  let currentHttpAc: AbortController | undefined;
  let isolationTimer: NodeJS.Timeout | undefined;
  const nowMs = options.nowMs ?? (() => performance.now());
  let lastServerConfirmationAt = nowMs();

  const clearIsolationTimer = () => {
    if (isolationTimer) clearTimeout(isolationTimer);
    isolationTimer = undefined;
  };

  const stopForIsolation = () => {
    if (stopped) return;
    stopped = true;
    if (pendingTimer) clearTimeout(pendingTimer);
    clearIsolationTimer();
    logger().warn(
      {jobId, isolationTimeoutSeconds: options.isolationTimeoutSeconds},
      'Heartbeat isolation fence elapsed; stopping local job work',
    );
    jobAbortController.abort('isolated');
    currentHttpAc?.abort();
  };

  const scheduleIsolationFence = (minimumDelayMs = 0) => {
    if (options.isolationTimeoutSeconds === undefined || stopped) return;
    clearIsolationTimer();
    const timeoutMs = options.isolationTimeoutSeconds * 1000;
    const remainingMs = Math.max(minimumDelayMs, timeoutMs - (nowMs() - lastServerConfirmationAt));
    isolationTimer = setTimeout(stopForIsolation, remainingMs);
  };

  const scheduleNext = () => {
    if (stopped) return;
    pendingTimer = setTimeout(tick, options.intervalMs);
  };

  const tick = async () => {
    if (stopped) return;

    const httpAc = new AbortController();
    currentHttpAc = httpAc;
    const sentGeneration = generation;
    const sentLeaseToken = getLeaseToken();

    const staleTimer = setTimeout(() => {
      logger().warn(
        {jobId, maxStaleMs: options.maxStaleMs},
        'Heartbeat exceeded max-stale; aborting in-flight call',
      );
      httpAc.abort();
    }, options.maxStaleMs);

    try {
      const capabilities = options.getToolCapabilities?.();
      const {
        cancel,
        cancellation_reason: cancellationReason,
        lease_token: renewedLeaseToken,
      } = await heartbeat(jobId, sentLeaseToken, {
        signal: httpAc.signal,
        ...(capabilities ? {capabilities} : {}),
      });
      if (stopped) return;
      lastServerConfirmationAt = nowMs();
      scheduleIsolationFence();
      if (generation === sentGeneration && renewedLeaseToken !== getLeaseToken()) {
        options.onLeaseTokenRenewed?.(renewedLeaseToken);
      }
      if (cancel) {
        logger().info({jobId}, 'Heartbeat returned cancel:true; aborting job');
        jobAbortController.abort(cancellationReason ?? 'cancelled');
        clearIsolationTimer();
        return;
      }
      scheduleNext();
    } catch (err) {
      if (stopped) return;
      // AbortError = max-stale guard fired; expected control flow, not a failure.
      if (isAbortError(err)) {
        scheduleNext();
        return;
      }
      if (err instanceof HTTPError && err.response.status === 404) {
        logger().info(
          {jobId},
          'Heartbeat returned 404; orchestration finalized this job, aborting runner-side',
        );
        jobAbortController.abort('orphaned');
        clearIsolationTimer();
        return;
      }
      logger().warn({jobId, err: String(err)}, 'Heartbeat failed; scheduling next tick');
      scheduleNext();
    } finally {
      clearTimeout(staleTimer);
      if (currentHttpAc === httpAc) currentHttpAc = undefined;
    }
  };

  pendingTimer = setTimeout(tick, options.intervalMs);
  // Ensure the first heartbeat gets a chance to confirm the lease, even when
  // the server-selected timeout is shorter than the heartbeat interval.
  scheduleIsolationFence(options.intervalMs);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (pendingTimer) clearTimeout(pendingTimer);
      clearIsolationTimer();
      if (currentHttpAc) currentHttpAc.abort();
    },
    bumpGeneration: () => {
      generation += 1;
    },
  };
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || err.name === 'TimeoutError';
}
