import {setTimeout as sleep} from 'node:timers/promises';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {db} from '#db/db.js';
import {
  type DemandStat,
  deleteReservationsByIds,
  pollDemandAndReserveTx,
  type ReservationGrant,
  type ReservationTemplate,
} from '#db/reservations.js';
import {
  type ActiveRunnerInstanceTemplateCount,
  listActiveRunnerInstanceCountsByTemplateTx,
  listProvisionerTerminateIntentRowsTx,
  listProvisionerTerminationAuthorizationsTx,
  type RunnerInstanceTerminateIntent,
} from '#db/runner-instances.js';
import {
  providerRunnerCountDivergenceCount,
  providerRunnerTerminateIntentIssuedCount,
  recordProviderRunnerActivationOutcome,
} from '#metrics/instance.js';
import {authorizeRunnerTerminationTx} from './termination-authorization.js';

export interface PollDemandParams {
  workspaceId: string;
  provisionerId: string;
  maxReservations: number;
  waitSeconds?: number | undefined;
  ttlSeconds: number;
  terminateIntentLimit: number;
  templates: ReservationTemplate[];
  signal: AbortSignal;
}

export interface PollDemandResult {
  stats: DemandStat[];
  reservations: ReservationGrant[];
  terminateRunnerInstanceIds: string[];
  terminationAuthorizations?: RunnerInstanceTerminateIntent[];
  /** Units reserved this poll. A bound-only allocation carries no launch grant, so this is what ends the long poll. */
  newlyReservedCount?: number;
}

export interface RunnerInstanceCountDivergence {
  templateKey: string;
  state: 'starting' | 'running';
  direction: 'backend-higher' | 'advertised-higher';
  delta: number;
}

interface PollDemandSnapshot {
  result: PollDemandResult;
  divergences: RunnerInstanceCountDivergence[];
  terminateIntents: RunnerInstanceTerminateIntent[];
}

export async function pollDemand(params: PollDemandParams): Promise<PollDemandResult> {
  const waitSeconds = Math.min(
    params.waitSeconds ?? config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS,
    config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS,
  );
  const deadlineMs = Date.now() + Math.max(0, waitSeconds) * 1000;
  const totalCapacity = params.templates.reduce(
    (total, template) => total + template.availableSlots,
    0,
  );
  let interval = config.RESERVATION_POLL_INTERVAL_MS;
  let lastSnapshot: PollDemandSnapshot = {
    result: {stats: [], reservations: [], terminateRunnerInstanceIds: []},
    divergences: [],
    terminateIntents: [],
  };

  while (true) {
    if (params.signal.aborted) return lastSnapshot.result;

    const previousSnapshot = lastSnapshot;
    const deadlinePassed = Date.now() >= deadlineMs;
    const snapshot = await db().transaction(async (tx) => {
      const demand = await pollDemandAndReserveTx(tx, {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        maxReservations: params.maxReservations,
        ttlSeconds: params.ttlSeconds,
        activationGraceSeconds: config.RESERVATION_TTL_SECONDS,
        templates: params.templates,
      });
      // Compatibility only: activation-timeout was historically derived by this
      // channel. Cancellation remains owned by the existing direct path until
      // graceful cleanup is implemented; it must never be authorized here.
      const legacyTerminateIntents = await listProvisionerTerminateIntentRowsTx(
        tx,
        {
          workspaceId: params.workspaceId,
          provisionerId: params.provisionerId,
          limit: params.terminateIntentLimit,
        },
        {
          authorize: async ({providerRunnerId, reason}) => {
            if (reason !== 'activation-timeout') return true;
            return (
              (
                await authorizeRunnerTerminationTx(tx, {
                  provisionerId: params.provisionerId,
                  providerRunnerId,
                  reason,
                })
              ).desiredIntent === 'terminate'
            );
          },
        },
      );
      const terminateIntents = await listProvisionerTerminationAuthorizationsTx(tx, {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        // Reserve delivery capacity for legacy intents so canonical authorizations
        // cannot starve them from the bounded response.
        limit: Math.max(0, params.terminateIntentLimit - legacyTerminateIntents.length),
      });
      const legacyIntentByRunnerId = new Map(
        legacyTerminateIntents.map((intent) => [intent.providerRunnerId, intent]),
      );
      const canonicalRunnerIds = new Set(
        terminateIntents.map((authorization) => authorization.providerRunnerId),
      );
      const deliveredIntents = [
        ...terminateIntents.map((authorization) => {
          const legacyIntent = legacyIntentByRunnerId.get(authorization.providerRunnerId);
          if (legacyIntent?.reason !== authorization.reason) return authorization;
          // The legacy query observes whether this is the first delivery before
          // it marks an activation timeout as reaped. Preserve that signal on
          // the canonical authorization rather than reading the post-update row.
          return legacyIntent.activationTimeoutRetry
            ? {...authorization, activationTimeoutRetry: true}
            : {
                providerRunnerId: authorization.providerRunnerId,
                reason: authorization.reason,
              };
        }),
        ...legacyTerminateIntents.filter(
          (legacyIntent) => !canonicalRunnerIds.has(legacyIntent.providerRunnerId),
        ),
      ].slice(0, params.terminateIntentLimit);
      const newlyReservedCount = demand.newlyReservedUnits.reduce(
        (total, reservation) => total + reservation.count,
        0,
      );
      const result: PollDemandResult = {
        stats: demand.stats,
        reservations: demand.reservations,
        ...(newlyReservedCount > 0 ? {newlyReservedCount} : {}),
        terminateRunnerInstanceIds: deliveredIntents.map((intent) => intent.providerRunnerId),
        ...(deliveredIntents.length > 0 ? {terminationAuthorizations: deliveredIntents} : {}),
      };

      if (
        !shouldReturn(
          result,
          params.maxReservations,
          totalCapacity,
          deadlinePassed,
          deliveredIntents,
        )
      ) {
        return {result, terminateIntents, divergences: []};
      }

      return {
        result,
        terminateIntents: deliveredIntents,
        divergences: calculateRunnerInstanceCountDivergences({
          advertisedTemplates: params.templates,
          backendCounts: await listActiveRunnerInstanceCountsByTemplateTx(tx, {
            workspaceId: params.workspaceId,
            provisionerId: params.provisionerId,
          }),
        }),
      };
    });
    if (params.signal.aborted) {
      await releaseReservationGrants(snapshot.result.reservations);
      return previousSnapshot.result;
    }

    lastSnapshot = snapshot;

    if (
      shouldReturn(
        lastSnapshot.result,
        params.maxReservations,
        totalCapacity,
        deadlinePassed,
        lastSnapshot.terminateIntents,
      )
    ) {
      recordPollDemandMetrics(params, lastSnapshot);
      return lastSnapshot.result;
    }

    const remainingWaitMs = Math.max(0, deadlineMs - Date.now());
    try {
      await sleep(Math.min(withJitter(interval), remainingWaitMs), undefined, {
        signal: params.signal,
      });
    } catch (error) {
      if (params.signal.aborted) return lastSnapshot.result;
      throw error;
    }
    interval = nextBackoffInterval(interval);
  }
}

export async function releaseReservationGrants(reservations: ReservationGrant[]): Promise<void> {
  // Fully adopted reservations are intentionally absent from this list: deleting
  // one on disconnect would orphan the runner bound to that reservation. They
  // remain protected until terminal cleanup or expiry.
  await deleteReservationsByIds(reservations.map((reservation) => reservation.reservationId));
}

export function shouldReturn(
  result: PollDemandResult,
  maxReservations: number,
  totalCapacity: number,
  deadlinePassed: boolean,
  terminateIntents?: readonly RunnerInstanceTerminateIntent[],
): boolean {
  const hasImmediateTerminateIntent =
    terminateIntents?.some(
      (intent) => intent.reason !== 'activation-timeout' || !intent.activationTimeoutRetry,
    ) ?? result.terminateRunnerInstanceIds.length > 0;

  return (
    maxReservations === 0 ||
    totalCapacity === 0 ||
    result.reservations.length > 0 ||
    (result.newlyReservedCount ?? 0) > 0 ||
    hasImmediateTerminateIntent ||
    deadlinePassed
  );
}

export function nextBackoffInterval(ms: number): number {
  return Math.min(ms * 1.5, config.RESERVATION_POLL_MAX_INTERVAL_MS);
}

export function withJitter(ms: number): number {
  return Math.random() * ms;
}

export function calculateRunnerInstanceCountDivergences(params: {
  advertisedTemplates: ReservationTemplate[];
  backendCounts: ActiveRunnerInstanceTemplateCount[];
}): RunnerInstanceCountDivergence[] {
  const advertisedCounts = new Map<string, number>();
  const backendCounts = new Map<string, number>();

  for (const template of params.advertisedTemplates) {
    addCount(advertisedCounts, countKey(template.templateKey, 'starting'), template.starting);
    addCount(advertisedCounts, countKey(template.templateKey, 'running'), template.running);
  }
  for (const count of params.backendCounts) {
    addCount(backendCounts, countKey(count.templateKey, count.state), count.count);
  }

  const keys = [...new Set([...advertisedCounts.keys(), ...backendCounts.keys()])].sort();
  return keys.flatMap((key) => {
    const advertised = advertisedCounts.get(key) ?? 0;
    const backend = backendCounts.get(key) ?? 0;
    if (advertised === backend) return [];

    const [templateKey, state] = splitCountKey(key);
    return [
      {
        templateKey,
        state,
        direction: backend > advertised ? 'backend-higher' : 'advertised-higher',
        delta: Math.abs(backend - advertised),
      },
    ];
  });
}

function recordPollDemandMetrics(params: PollDemandParams, snapshot: PollDemandSnapshot): void {
  for (const divergence of snapshot.divergences) {
    logger().debug(
      {
        workspaceId: params.workspaceId,
        provisionerId: params.provisionerId,
        templateKey: divergence.templateKey,
        state: divergence.state,
        direction: divergence.direction,
        delta: divergence.delta,
      },
      'provisioned runner count divergence observed',
    );

    const attributes = {
      state: divergence.state,
      direction: divergence.direction,
      ...(config.PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED
        ? {template_key: divergence.templateKey}
        : {}),
    };
    providerRunnerCountDivergenceCount.add(divergence.delta, attributes);
  }
  for (const intent of snapshot.terminateIntents) {
    providerRunnerTerminateIntentIssuedCount.add(1, {
      surface: 'poll-demand',
      reason: intent.reason,
    });
    // Retries redeliver an intent already counted on its first emission.
    if (intent.reason === 'activation-timeout' && !intent.activationTimeoutRetry) {
      recordProviderRunnerActivationOutcome({outcome: 'reaped'});
    }
  }
}

function addCount(counts: Map<string, number>, key: string, count: number): void {
  counts.set(key, (counts.get(key) ?? 0) + count);
}

function countKey(templateKey: string, state: 'starting' | 'running'): string {
  return `${templateKey}\0${state}`;
}

function splitCountKey(key: string): [string, 'starting' | 'running'] {
  const [templateKey, state] = key.split('\0');
  if (!templateKey || (state !== 'starting' && state !== 'running')) {
    throw new Error(`Invalid provisioned runner count key: ${key}`);
  }
  return [templateKey, state];
}
