import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  claimIntegrationSecretCleanups,
  completeIntegrationSecretCleanup,
  type IntegrationSecretCleanup,
  retryIntegrationSecretCleanup,
} from '#db/secret-cleanups.js';

const RETRY_BASE_DELAY_MS = 60 * 1_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;
const STUCK_CLEANUP_ALERT_CACHE_LIMIT = 10_000;
// Attempts, not hours: the backoff caps at RETRY_MAX_DELAY_MS, so a stuck row is retried
// hourly and this threshold lands about a week out. Revisit it alongside that cap.
const STUCK_CLEANUP_ATTEMPT_COUNT = 7 * 24;
const reportedStuckCleanupIds = new Set<string>();

export interface ProcessIntegrationSecretCleanupsOptions {
  registry: IntegrationProviderRegistry;
  connectionId?: string | undefined;
  connection?: IntegrationConnection | undefined;
  limit?: number | undefined;
  now?: Date | undefined;
  heartbeat?: (() => void) | undefined;
}

export interface ProcessIntegrationSecretCleanupsResult {
  claimed: number;
  completed: number;
  failed: number;
  unavailable: number;
  /** Rows whose lease was taken over by another sweep before this one acknowledged them. */
  unacknowledged: number;
}

type CleanupRetryReason = 'provider-unavailable' | 'cleanup-failed';

export async function processIntegrationSecretCleanups(
  options: ProcessIntegrationSecretCleanupsOptions,
): Promise<ProcessIntegrationSecretCleanupsResult> {
  const cleanups = await claimIntegrationSecretCleanups({
    connectionId: options.connectionId,
    limit: options.limit ?? DEFAULT_BATCH_SIZE,
    now: options.now ?? new Date(),
  });
  const result: ProcessIntegrationSecretCleanupsResult = {
    claimed: cleanups.length,
    completed: 0,
    failed: 0,
    unavailable: 0,
    unacknowledged: 0,
  };

  for (const cleanup of cleanups) {
    // Keep heartbeating through the provider call itself. Beating only between rows would
    // let one slow deletion trip the activity's heartbeat timeout and kill the whole sweep.
    options.heartbeat?.();
    const heartbeatInterval = setInterval(() => options.heartbeat?.(), HEARTBEAT_INTERVAL_MS);
    // A single row must never strand the rest of the claimed batch under its lease.
    try {
      const provider = options.registry
        .list()
        .find((candidate) => candidate.provider === cleanup.provider);
      if (!provider) {
        result.unavailable += 1;
        if (!(await scheduleRetry(cleanup, 'provider-unavailable'))) {
          result.unacknowledged += 1;
        }
        continue;
      }

      // A loaded provider without the hook has no secrets to delete, so the intent is
      // already satisfied and the row can retire.
      await provider.deleteConnectionSecrets?.(getCleanupConnection(cleanup, options.connection));
      const acknowledged = await completeIntegrationSecretCleanup({
        id: cleanup.id,
        leaseToken: requireLeaseToken(cleanup),
      });
      if (acknowledged) {
        result.completed += 1;
      } else {
        result.unacknowledged += 1;
        logLeaseLost(cleanup, 'complete');
      }
    } catch (error) {
      result.failed += 1;
      if (!(await scheduleRetry(cleanup, 'cleanup-failed', error))) {
        result.unacknowledged += 1;
      }
    } finally {
      clearInterval(heartbeatInterval);
      options.heartbeat?.();
    }
  }

  return result;
}

function getCleanupConnection(
  cleanup: IntegrationSecretCleanup,
  connection: IntegrationConnection | undefined,
): IntegrationConnection {
  if (connection?.id === cleanup.connectionId) return connection;
  return {
    id: cleanup.connectionId,
    workspaceId: cleanup.workspaceId,
    provider: cleanup.provider,
    externalAccountId: cleanup.externalAccountId,
    slug: cleanup.slug,
    displayName: cleanup.displayName,
    lifecycleStatus: cleanup.lifecycleStatus,
    createdAt: cleanup.connectionCreatedAt,
    updatedAt: cleanup.connectionUpdatedAt,
  };
}

async function scheduleRetry(
  cleanup: IntegrationSecretCleanup,
  reason: CleanupRetryReason,
  error?: unknown,
): Promise<boolean> {
  const delayMs = retryDelayMs(cleanup.attemptCount);
  logCleanupRetry(cleanup, reason, delayMs, error);
  if (error !== undefined) {
    reportError(error, {
      boundary: 'integration.secret-cleanup',
      operation: 'delete-connection-secrets',
      tags: {provider: cleanup.provider},
    });
  }
  // Keep escalating past the threshold. A stuck row means secrets may still exist, and
  // one missed alert would hide that forever. The bounded per-cleanup cache suppresses
  // duplicate reports in this worker while allowing a fresh process to re-alert.
  if (cleanup.attemptCount >= STUCK_CLEANUP_ATTEMPT_COUNT) {
    const stuckErrorMessage = 'Integration connection secret cleanup exceeded its retry threshold';
    logger().error(
      {
        provider: cleanup.provider,
        connectionId: cleanup.connectionId,
        attempt: cleanup.attemptCount,
      },
      stuckErrorMessage,
    );
    if (!reportedStuckCleanupIds.has(cleanup.id)) {
      const eventId = reportError(new Error(stuckErrorMessage), {
        boundary: 'integration.secret-cleanup',
        operation: 'stuck-cleanup',
        tags: {provider: cleanup.provider},
        extra: {cleanupId: cleanup.id},
      });
      if (eventId) {
        reportedStuckCleanupIds.add(cleanup.id);
        if (reportedStuckCleanupIds.size > STUCK_CLEANUP_ALERT_CACHE_LIMIT) {
          const oldestCleanupId = reportedStuckCleanupIds.values().next().value;
          if (oldestCleanupId !== undefined) reportedStuckCleanupIds.delete(oldestCleanupId);
        }
      }
    }
  }

  try {
    const rescheduled = await retryIntegrationSecretCleanup({
      id: cleanup.id,
      leaseToken: requireLeaseToken(cleanup),
      delayMs,
    });
    if (!rescheduled) {
      logLeaseLost(cleanup, 'retry');
      return false;
    }
    return true;
  } catch (retryError) {
    // The lease expires on its own, so a later sweep still picks this row up.
    logger().error(
      {provider: cleanup.provider, connectionId: cleanup.connectionId, err: retryError},
      'Failed to reschedule integration connection secret cleanup',
    );
    reportError(retryError, {
      boundary: 'integration.secret-cleanup',
      operation: 'reschedule-cleanup',
      tags: {provider: cleanup.provider},
    });
    return false;
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1), RETRY_MAX_DELAY_MS);
}

function requireLeaseToken(cleanup: IntegrationSecretCleanup): string {
  if (!cleanup.leaseToken) throw new Error('Claimed integration secret cleanup has no lease token');
  return cleanup.leaseToken;
}

function logCleanupRetry(
  cleanup: IntegrationSecretCleanup,
  reason: CleanupRetryReason,
  delayMs: number,
  error: unknown,
): void {
  logger().warn(
    {
      provider: cleanup.provider,
      connectionId: cleanup.connectionId,
      attempt: cleanup.attemptCount,
      reason,
      delayMs,
      ...(error === undefined ? {} : {err: error}),
    },
    'Integration connection secret cleanup will be retried',
  );
}

function logLeaseLost(cleanup: IntegrationSecretCleanup, operation: 'complete' | 'retry'): void {
  logger().warn(
    {
      provider: cleanup.provider,
      connectionId: cleanup.connectionId,
      attempt: cleanup.attemptCount,
      operation,
    },
    'Integration connection secret cleanup lease was lost before acknowledgement',
  );
}
