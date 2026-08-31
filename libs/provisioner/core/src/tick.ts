import * as nodeCrypto from 'node:crypto';
import type {
  CreateRunnerInstancesResponseDto,
  DemandStatDto,
  PollDemandTemplateDto,
} from '@shipfox/api-runners-dto';
import {ProvisionerAuthenticationError, type ProvisionerClient} from '#api-client.js';
import {type PlannedLaunchGroup, planLaunches, templateAvailableSlots} from '#capacity.js';
import type {ProviderRunnerTracker} from '#tracker.js';
import type {LaunchRunner, ProvisionerTemplate, TerminateRunners} from '#types.js';

/** The API caps reservations per poll at 1000; never advertise a larger appetite. */
const MAX_RESERVATIONS_PER_POLL = 1000;

const cryptoWithUuidV7 = nodeCrypto as typeof nodeCrypto & {
  randomUUIDv7(): string;
};
type WarmLaunchGroup<Spec> = {
  readonly reservationId: undefined;
  readonly template: ProvisionerTemplate<Spec>;
  readonly count: number;
};
type LaunchGroup<Spec> = PlannedLaunchGroup<Spec> | WarmLaunchGroup<Spec>;
type PlannedRunner<Spec> = {
  readonly providerRunnerId: string;
  readonly template: ProvisionerTemplate<Spec>;
};

export type RunnerEnvFactory<Spec> = (args: {
  template: ProvisionerTemplate<Spec>;
  bootstrapToken: string;
}) => Record<string, string>;

export type ProviderPass = <Result>(operation: () => Promise<Result>) => Promise<Result>;

export interface ProvisionerTickDeps<Spec> {
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProviderRunnerTracker;
  readonly launch: LaunchRunner<Spec>;
  readonly terminate?: TerminateRunners;
  readonly buildRunnerEnv: RunnerEnvFactory<Spec>;
  /** Optional reservation lifetime requested for the demand poll, in seconds. */
  readonly reservationTtlSeconds?: number;
  readonly reservationLimit: number;
  readonly launchBudget: number | (() => number);
  readonly waitSeconds: number;
  readonly runnerInstanceBatchSize: number;
  readonly retryIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly withProviderLock?: ProviderPass;
}

export type ProvisionerTerminationOutcome =
  | {status: 'succeeded'}
  | {status: 'not_needed'}
  | {status: 'not_attempted'}
  | {status: 'failed'; cause: string}
  | {status: 'cancelled'};

export interface ProvisionerTickResult {
  readonly stats: readonly DemandStatDto[];
  readonly reservationCount: number;
  readonly reservedRunnerCount: number;
  readonly providerTermination: ProvisionerTerminationOutcome;
  readonly plannedCount: number;
  readonly launchAttemptedCount: number;
  readonly launchedCount: number;
  readonly runnerInstanceCreationFailureCount: number;
  readonly runnerInstanceCreationFailureReason?: string;
  readonly reservationConsumedOrStaleCount: number;
  readonly providerLaunchFailureCount: number;
  readonly providerLaunchFailureReason?: string;
  readonly launchLifecycleIncompleteCount: number;
  readonly launchLifecycleIncompleteReason?: string;
}

/**
 * One cycle of the control loop: advertise current capacity, long-poll demand, plan
 * launches for the reservations the API grants without exceeding local concurrency,
 * create a runner instance and bootstrap token per planned runner, and hand each to the launcher.
 * All mutation flows through injected ports, so the cycle is deterministic to test.
 */
export async function runProvisionerTick<Spec>(
  deps: ProvisionerTickDeps<Spec>,
): Promise<ProvisionerTickResult> {
  const counts = deps.tracker.countsByTemplate();
  const advertisements: PollDemandTemplateDto[] = deps.templates.map((template) => {
    const templateCounts = counts.get(template.key) ?? {starting: 0, running: 0};
    return {
      template_key: template.key,
      labels: [...template.labels],
      available_slots: templateAvailableSlots(template, templateCounts),
      starting: templateCounts.starting,
      running: templateCounts.running,
    };
  });

  const totalAvailable = advertisements.reduce(
    (sum, advertisement) => sum + advertisement.available_slots,
    0,
  );
  const launchBudget = resolveLaunchBudget(deps.launchBudget);
  // Respect local max concurrency before asking: never reserve more than there are
  // free slots to fill (and never more than the API will grant in one poll).
  const pollReservationLimit = Math.min(
    deps.reservationLimit,
    launchBudget,
    totalAvailable,
    MAX_RESERVATIONS_PER_POLL,
  );

  const response = await deps.client.pollDemand(
    {
      wait_seconds: deps.waitSeconds,
      ...(deps.reservationTtlSeconds !== undefined
        ? {reservation_ttl_seconds: deps.reservationTtlSeconds}
        : {}),
      max_reservations: pollReservationLimit,
      templates: advertisements,
    },
    deps.signal ? {signal: deps.signal} : {},
  );

  const complete = () => completeProvisionerTick(deps, response);
  return deps.withProviderLock ? deps.withProviderLock(complete) : complete();
}

async function completeProvisionerTick<Spec>(
  deps: ProvisionerTickDeps<Spec>,
  response: Awaited<ReturnType<ProvisionerClient['pollDemand']>>,
): Promise<ProvisionerTickResult> {
  const providerTermination = await resolveProviderTermination(deps, response);
  const allGroups = planTickLaunchGroups(deps, response);
  const plannedCount = allGroups.reduce((sum, group) => sum + group.count, 0);
  const reservedRunnerCount =
    response.newly_reserved_count ??
    response.reservations.reduce((sum, reservation) => sum + reservation.count, 0);
  const launchStats = await launchTickGroups(
    limitLaunchGroups(allGroups, resolveLaunchBudget(deps.launchBudget)),
    deps,
  );

  return {
    stats: response.stats,
    reservationCount: response.reservations.length,
    reservedRunnerCount,
    providerTermination,
    plannedCount,
    launchAttemptedCount: launchStats.attempted,
    launchedCount: launchStats.launched,
    runnerInstanceCreationFailureCount: launchStats.runnerInstanceCreationFailureCount,
    ...(launchStats.runnerInstanceCreationFailureReason
      ? {runnerInstanceCreationFailureReason: launchStats.runnerInstanceCreationFailureReason}
      : {}),
    reservationConsumedOrStaleCount: launchStats.reservationConsumedOrStaleCount,
    providerLaunchFailureCount: launchStats.providerLaunchFailureCount,
    ...(launchStats.providerLaunchFailureReason
      ? {providerLaunchFailureReason: launchStats.providerLaunchFailureReason}
      : {}),
    launchLifecycleIncompleteCount: launchStats.launchLifecycleIncompleteCount,
    ...(launchStats.launchLifecycleIncompleteReason
      ? {launchLifecycleIncompleteReason: launchStats.launchLifecycleIncompleteReason}
      : {}),
  };
}

async function resolveProviderTermination<Spec>(
  deps: ProvisionerTickDeps<Spec>,
  response: Awaited<ReturnType<ProvisionerClient['pollDemand']>>,
): Promise<ProvisionerTerminationOutcome> {
  if (deps.signal?.aborted) return {status: 'cancelled'};
  if (!deps.terminate) {
    return response.terminate_provider_runner_ids.length > 0
      ? {status: 'not_attempted'}
      : {status: 'not_needed'};
  }
  try {
    await deps.terminate(response.terminate_provider_runner_ids);
    return {status: 'succeeded'};
  } catch (error) {
    if (deps.signal?.aborted) return {status: 'cancelled'};
    if (error instanceof ProvisionerAuthenticationError) throw error;
    return {status: 'failed', cause: errorReason(error)};
  }
}

function planTickLaunchGroups<Spec>(
  deps: ProvisionerTickDeps<Spec>,
  response: Awaited<ReturnType<ProvisionerClient['pollDemand']>>,
): LaunchGroup<Spec>[] {
  const countsByTemplate = deps.tracker.countsByTemplate();
  const availableByKey = new Map(
    deps.templates.map((template) => {
      const counts = countsByTemplate.get(template.key) ?? {starting: 0, running: 0};
      return [template.key, templateAvailableSlots(template, counts)];
    }),
  );
  const planned = planLaunches({
    reservations: response.reservations.map((reservation) => ({
      reservationId: reservation.reservation_id,
      labels: reservation.labels,
      count: reservation.count,
    })),
    templates: deps.templates,
    availableByKey,
  });
  const plannedByTemplate = new Map<string, number>();
  for (const group of planned) {
    plannedByTemplate.set(
      group.template.key,
      (plannedByTemplate.get(group.template.key) ?? 0) + group.count,
    );
  }
  const hotGroups = deps.templates.flatMap((template) => {
    const counts = countsByTemplate.get(template.key) ?? {starting: 0, running: 0};
    const count = Math.max(
      0,
      (template.targetConcurrency ?? 0) -
        counts.starting -
        counts.running -
        (plannedByTemplate.get(template.key) ?? 0),
    );
    return count > 0 ? [{reservationId: undefined, template, count}] : [];
  });
  return [...planned, ...hotGroups];
}

interface LaunchStats {
  attempted: number;
  launched: number;
  runnerInstanceCreationFailureCount: number;
  runnerInstanceCreationFailureReason?: string | undefined;
  reservationConsumedOrStaleCount: number;
  providerLaunchFailureCount: number;
  providerLaunchFailureReason?: string | undefined;
  launchLifecycleIncompleteCount: number;
  launchLifecycleIncompleteReason?: string | undefined;
}

function emptyLaunchStats(): LaunchStats {
  return {
    attempted: 0,
    launched: 0,
    runnerInstanceCreationFailureCount: 0,
    reservationConsumedOrStaleCount: 0,
    providerLaunchFailureCount: 0,
    launchLifecycleIncompleteCount: 0,
  };
}

async function launchTickGroups<Spec>(
  budgetedGroups: readonly LaunchGroup<Spec>[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<LaunchStats> {
  const totals = emptyLaunchStats();
  const reservationGroups = budgetedGroups.filter(
    (group): group is PlannedLaunchGroup<Spec> => group.reservationId !== undefined,
  );
  const warmGroups = budgetedGroups.filter(
    (group): group is WarmLaunchGroup<Spec> => group.reservationId === undefined,
  );
  for (const [reservationId, groups] of groupByReservation(reservationGroups)) {
    if (deps.signal?.aborted) break;
    mergeLaunchStats(totals, await launchReservation(reservationId, groups, deps));
  }

  if (!deps.signal?.aborted && warmGroups.length > 0) {
    mergeLaunchStats(totals, await launchReservation(undefined, warmGroups, deps));
  }
  return totals;
}

function mergeLaunchStats(target: LaunchStats, source: LaunchStats): void {
  target.attempted += source.attempted;
  target.launched += source.launched;
  target.runnerInstanceCreationFailureCount += source.runnerInstanceCreationFailureCount;
  target.runnerInstanceCreationFailureReason ??= source.runnerInstanceCreationFailureReason;
  target.reservationConsumedOrStaleCount += source.reservationConsumedOrStaleCount;
  target.providerLaunchFailureCount += source.providerLaunchFailureCount;
  target.providerLaunchFailureReason ??= source.providerLaunchFailureReason;
  target.launchLifecycleIncompleteCount += source.launchLifecycleIncompleteCount;
  target.launchLifecycleIncompleteReason ??= source.launchLifecycleIncompleteReason;
}

async function launchReservation<Spec>(
  reservationId: string | undefined,
  groups: readonly (
    | PlannedLaunchGroup<Spec>
    | {reservationId: undefined; template: ProvisionerTemplate<Spec>; count: number}
  )[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<LaunchStats> {
  // A fresh, never-reused provider identity per runner names the compute resource;
  // names the resource, and keys idempotent reporting and reconciliation. UUIDv7 keeps
  // generated ids time-ordered without adding a dependency.
  const plannedRunners = groups.flatMap((group) =>
    Array.from({length: group.count}, () => ({
      providerRunnerId: cryptoWithUuidV7.randomUUIDv7(),
      template: group.template,
    })),
  );
  const stats = emptyLaunchStats();
  const batches = chunk(plannedRunners, deps.runnerInstanceBatchSize);
  let batchStartIndex = 0;
  for (const batch of batches) {
    if (deps.signal?.aborted) break;
    const creation = await createRunnerBatch(reservationId, batch, deps);
    if (creation.kind === 'failed') {
      stats.attempted += batch.length;
      stats.runnerInstanceCreationFailureCount += batch.length;
      stats.runnerInstanceCreationFailureReason ??= creation.reason;
      batchStartIndex += batch.length;
      continue;
    }

    const reservationShortfall = recordRunnerCreationShortfall(
      stats,
      reservationId,
      batch.length,
      creation.response,
    );
    await launchCreatedRunnerBatch(reservationId, batch, creation.response, deps, stats);

    if (reservationShortfall) {
      stats.reservationConsumedOrStaleCount +=
        plannedRunners.length -
        batchStartIndex -
        Math.min(creation.response.runner_instances.length, batch.length);
      break;
    }
    batchStartIndex += batch.length;
  }

  return stats;
}

async function createRunnerBatch<Spec>(
  reservationId: string | undefined,
  batch: readonly PlannedRunner<Spec>[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<
  {kind: 'created'; response: CreateRunnerInstancesResponseDto} | {kind: 'failed'; reason: string}
> {
  try {
    const response = await deps.client.createRunnerInstances(
      {
        runner_instances: batch.map((runner) => ({
          template_key: runner.template.key,
          ...(reservationId ? {reservation_id: reservationId} : {}),
        })),
      },
      deps.signal ? {signal: deps.signal} : {},
    );
    return {kind: 'created', response};
  } catch (error) {
    if (error instanceof ProvisionerAuthenticationError || deps.signal?.aborted) throw error;
    return {kind: 'failed', reason: instanceCreationFailureReason(error)};
  }
}

function recordRunnerCreationShortfall(
  stats: LaunchStats,
  reservationId: string | undefined,
  requestedCount: number,
  response: CreateRunnerInstancesResponseDto,
): boolean {
  const missingCount = Math.max(0, requestedCount - response.runner_instances.length);
  // Reservation shortfalls are expected control-plane races. The reservation id
  // fallback keeps a new provisioner compatible with an older API.
  const reservationShortfall =
    missingCount > 0 && (reservationId !== undefined || response.reservation_unavailable === true);
  if (missingCount > 0 && !reservationShortfall) {
    stats.attempted += missingCount;
    stats.runnerInstanceCreationFailureCount += missingCount;
    stats.runnerInstanceCreationFailureReason ??= `Runner instance creation returned ${response.runner_instances.length} of ${requestedCount} requested instances.`;
  }
  return reservationShortfall;
}

async function launchCreatedRunnerBatch<Spec>(
  reservationId: string | undefined,
  batch: readonly PlannedRunner<Spec>[],
  response: CreateRunnerInstancesResponseDto,
  deps: ProvisionerTickDeps<Spec>,
  stats: LaunchStats,
): Promise<void> {
  for (const [responseIndex, createdRunner] of response.runner_instances.entries()) {
    if (deps.signal?.aborted) break;
    // New API responses carry the request index. Older responses are accepted
    // prefixes, so the response position remains a safe compatibility fallback.
    const plannedRunner = batch[createdRunner.request_index ?? responseIndex];
    if (!plannedRunner) continue;
    await launchCreatedRunner(reservationId, plannedRunner, createdRunner, deps, stats);
  }
}

async function launchCreatedRunner<Spec>(
  reservationId: string | undefined,
  plannedRunner: PlannedRunner<Spec>,
  createdRunner: CreateRunnerInstancesResponseDto['runner_instances'][number],
  deps: ProvisionerTickDeps<Spec>,
  stats: LaunchStats,
): Promise<void> {
  const {template} = plannedRunner;
  deps.tracker.recordStarting({
    providerRunnerId: plannedRunner.providerRunnerId,
    templateKey: template.key,
  });
  stats.attempted += 1;
  try {
    const outcome = (await deps.launch({
      runnerInstanceId: createdRunner.runner_instance_id,
      providerRunnerId: plannedRunner.providerRunnerId,
      ...(reservationId ? {reservationId} : {}),
      template,
      bootstrapToken: createdRunner.bootstrap_token,
      runnerEnv: deps.buildRunnerEnv({template, bootstrapToken: createdRunner.bootstrap_token}),
    })) ?? {containerStarted: true, identityAttached: true, reported: true};
    if (!outcome.containerStarted) {
      stats.providerLaunchFailureCount += 1;
      deps.tracker.remove(plannedRunner.providerRunnerId);
      stats.providerLaunchFailureReason ??= launchLifecycleFailureReason(outcome);
      return;
    }
    stats.launched += 1;
    if (!outcome.identityAttached || !outcome.reported) {
      stats.launchLifecycleIncompleteCount += 1;
      stats.launchLifecycleIncompleteReason ??= launchLifecycleFailureReason(outcome);
    }
  } catch (error) {
    stats.providerLaunchFailureCount += 1;
    deps.tracker.remove(plannedRunner.providerRunnerId);
    if (error instanceof ProvisionerAuthenticationError) throw error;
    stats.providerLaunchFailureReason ??= launchFailureReason(error);
  }
}

function instanceCreationFailureReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function resolveLaunchBudget(budget: number | (() => number)): number {
  return typeof budget === 'function' ? budget() : budget;
}

function launchFailureReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function launchLifecycleFailureReason(outcome: {
  containerStarted: boolean;
  identityAttached: boolean;
  reported: boolean;
}): string {
  const missing = [
    !outcome.containerStarted ? 'container' : undefined,
    !outcome.identityAttached ? 'identity' : undefined,
    !outcome.reported ? 'report' : undefined,
  ].filter((item): item is string => item !== undefined);
  return `Runner launch lifecycle incomplete: ${missing.join(', ') || 'unknown step'}.`;
}
function limitLaunchGroups<Spec>(
  groups: readonly LaunchGroup<Spec>[],
  budget: number,
): LaunchGroup<Spec>[] {
  let remaining = Math.max(0, budget);
  const limited: LaunchGroup<Spec>[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const count = Math.min(group.count, remaining);
    if (count > 0) limited.push({...group, count});
    remaining -= count;
  }
  return limited;
}
function groupByReservation<Spec>(
  planned: readonly PlannedLaunchGroup<Spec>[],
): Map<string, PlannedLaunchGroup<Spec>[]> {
  const byReservation = new Map<string, PlannedLaunchGroup<Spec>[]>();
  for (const group of planned) {
    const existing = byReservation.get(group.reservationId);
    if (existing) existing.push(group);
    else byReservation.set(group.reservationId, [group]);
  }
  return byReservation;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
