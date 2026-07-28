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

export type RunnerEnvFactory<Spec> = (args: {
  template: ProvisionerTemplate<Spec>;
  bootstrapToken: string;
}) => Record<string, string>;

export interface ProvisionerTickDeps<Spec> {
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProviderRunnerTracker;
  readonly launch: LaunchRunner<Spec>;
  readonly terminate?: TerminateRunners;
  readonly buildRunnerEnv: RunnerEnvFactory<Spec>;
  readonly reservationLimit: number;
  readonly launchBudget: number;
  readonly waitSeconds: number;
  readonly runnerInstanceBatchSize: number;
  readonly retryIntervalMs?: number;
  readonly signal?: AbortSignal;
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

  const availableByKey = new Map(
    advertisements.map((advertisement) => [
      advertisement.template_key,
      advertisement.available_slots,
    ]),
  );
  const totalAvailable = advertisements.reduce(
    (sum, advertisement) => sum + advertisement.available_slots,
    0,
  );
  // Respect local max concurrency before asking: never reserve more than there are
  // free slots to fill (and never more than the API will grant in one poll).
  const pollReservationLimit = Math.min(
    deps.reservationLimit,
    deps.launchBudget,
    totalAvailable,
    MAX_RESERVATIONS_PER_POLL,
  );

  const response = await deps.client.pollDemand(
    {
      wait_seconds: deps.waitSeconds,
      max_reservations: pollReservationLimit,
      templates: advertisements,
    },
    deps.signal ? {signal: deps.signal} : {},
  );

  let providerTermination: ProvisionerTerminationOutcome;
  if (deps.signal?.aborted) {
    providerTermination = {status: 'cancelled'};
  } else if (deps.terminate) {
    try {
      await deps.terminate(response.terminate_provider_runner_ids);
      providerTermination = {status: 'succeeded'};
    } catch (error) {
      if (deps.signal?.aborted) {
        providerTermination = {status: 'cancelled'};
      } else if (error instanceof ProvisionerAuthenticationError) {
        throw error;
      } else {
        providerTermination = {
          status: 'failed',
          cause: errorReason(error),
        };
      }
    }
  } else if (response.terminate_provider_runner_ids.length > 0) {
    providerTermination = {status: 'not_attempted'};
  } else {
    providerTermination = {status: 'not_needed'};
  }

  const planned = planLaunches({
    reservations: response.reservations.map((reservation) => ({
      reservationId: reservation.reservation_id,
      labels: reservation.labels,
      count: reservation.count,
    })),
    templates: deps.templates,
    availableByKey,
  });

  let plannedCount = planned.reduce((sum, group) => sum + group.count, 0);
  const reservedRunnerCount = response.reservations.reduce(
    (sum, reservation) => sum + reservation.count,
    0,
  );

  let launchAttemptedCount = 0;
  let launchedCount = 0;
  let runnerInstanceCreationFailureCount = 0;
  let runnerInstanceCreationFailureReason: string | undefined;
  let providerLaunchFailureCount = 0;
  let providerLaunchFailureReason: string | undefined;
  let launchLifecycleIncompleteCount = 0;
  let launchLifecycleIncompleteReason: string | undefined;
  const plannedByTemplate = new Map<string, number>();
  for (const group of planned) {
    plannedByTemplate.set(
      group.template.key,
      (plannedByTemplate.get(group.template.key) ?? 0) + group.count,
    );
  }
  const hotGroups = deps.templates.flatMap((template) => {
    const counts = deps.tracker.countsByTemplate().get(template.key) ?? {starting: 0, running: 0};
    const count = Math.max(
      0,
      (template.targetConcurrency ?? 0) -
        counts.starting -
        counts.running -
        (plannedByTemplate.get(template.key) ?? 0),
    );
    return count > 0 ? [{reservationId: undefined, template, count}] : [];
  });
  const allGroups: LaunchGroup<Spec>[] = [...planned, ...hotGroups];
  plannedCount = allGroups.reduce((sum, group) => sum + group.count, 0);
  const budgetedGroups = limitLaunchGroups(allGroups, deps.launchBudget);
  const reservationGroups = budgetedGroups.filter(
    (group): group is PlannedLaunchGroup<Spec> => group.reservationId !== undefined,
  );
  const warmGroups = budgetedGroups.filter(
    (group): group is WarmLaunchGroup<Spec> => group.reservationId === undefined,
  );
  for (const [reservationId, groups] of groupByReservation(reservationGroups)) {
    if (deps.signal?.aborted) break;
    const result = await launchReservation(reservationId, groups, deps);
    launchAttemptedCount += result.attempted;
    launchedCount += result.launched;
    runnerInstanceCreationFailureCount += result.runnerInstanceCreationFailureCount;
    runnerInstanceCreationFailureReason ??= result.runnerInstanceCreationFailureReason;
    providerLaunchFailureCount += result.providerLaunchFailureCount;
    providerLaunchFailureReason ??= result.providerLaunchFailureReason;
    launchLifecycleIncompleteCount += result.launchLifecycleIncompleteCount;
    launchLifecycleIncompleteReason ??= result.launchLifecycleIncompleteReason;
  }

  if (!deps.signal?.aborted && warmGroups.length > 0) {
    const result = await launchReservation(undefined, warmGroups, deps);
    launchAttemptedCount += result.attempted;
    launchedCount += result.launched;
    runnerInstanceCreationFailureCount += result.runnerInstanceCreationFailureCount;
    runnerInstanceCreationFailureReason ??= result.runnerInstanceCreationFailureReason;
    providerLaunchFailureCount += result.providerLaunchFailureCount;
    providerLaunchFailureReason ??= result.providerLaunchFailureReason;
    launchLifecycleIncompleteCount += result.launchLifecycleIncompleteCount;
    launchLifecycleIncompleteReason ??= result.launchLifecycleIncompleteReason;
  }

  return {
    stats: response.stats,
    reservationCount: response.reservations.length,
    reservedRunnerCount,
    providerTermination,
    plannedCount,
    launchAttemptedCount,
    launchedCount,
    runnerInstanceCreationFailureCount,
    ...(runnerInstanceCreationFailureReason ? {runnerInstanceCreationFailureReason} : {}),
    providerLaunchFailureCount,
    ...(providerLaunchFailureReason ? {providerLaunchFailureReason} : {}),
    launchLifecycleIncompleteCount,
    ...(launchLifecycleIncompleteReason ? {launchLifecycleIncompleteReason} : {}),
  };
}

async function launchReservation<Spec>(
  reservationId: string | undefined,
  groups: readonly (
    | PlannedLaunchGroup<Spec>
    | {reservationId: undefined; template: ProvisionerTemplate<Spec>; count: number}
  )[],
  deps: ProvisionerTickDeps<Spec>,
): Promise<{
  attempted: number;
  launched: number;
  runnerInstanceCreationFailureCount: number;
  runnerInstanceCreationFailureReason?: string;
  providerLaunchFailureCount: number;
  providerLaunchFailureReason?: string;
  launchLifecycleIncompleteCount: number;
  launchLifecycleIncompleteReason?: string;
}> {
  // A fresh, never-reused provider identity per runner names the compute resource;
  // names the resource, and keys idempotent reporting and reconciliation. UUIDv7 keeps
  // generated ids time-ordered without adding a dependency.
  const plannedRunners = groups.flatMap((group) =>
    Array.from({length: group.count}, () => ({
      providerRunnerId: cryptoWithUuidV7.randomUUIDv7(),
      template: group.template,
    })),
  );
  const templateById = new Map<string, ProvisionerTemplate<Spec>>(
    plannedRunners.map((runner) => [runner.providerRunnerId, runner.template]),
  );

  let attempted = 0;
  let launched = 0;
  let runnerInstanceCreationFailureCount = 0;
  let runnerInstanceCreationFailureReason: string | undefined;
  let providerLaunchFailureCount = 0;
  let providerLaunchFailureReason: string | undefined;
  let launchLifecycleIncompleteCount = 0;
  let launchLifecycleIncompleteReason: string | undefined;
  for (const batch of chunk(plannedRunners, deps.runnerInstanceBatchSize)) {
    if (deps.signal?.aborted) break;
    let created: CreateRunnerInstancesResponseDto;
    try {
      created = await deps.client.createRunnerInstances(
        {
          runner_instances: batch.map((runner) => ({
            template_key: runner.template.key,
            ...(reservationId ? {reservation_id: reservationId} : {}),
          })),
        },
        deps.signal ? {signal: deps.signal} : {},
      );
    } catch (error) {
      if (error instanceof ProvisionerAuthenticationError) throw error;
      if (deps.signal?.aborted) throw error;
      // Leave these slots free: the reservation TTL releases the demand and another
      // tick (or another provisioner) can pick it up.
      attempted += batch.length;
      runnerInstanceCreationFailureCount += batch.length;
      runnerInstanceCreationFailureReason ??= instanceCreationFailureReason(error);
      continue;
    }

    const missingCount = Math.max(0, batch.length - created.runner_instances.length);
    if (missingCount > 0) {
      attempted += missingCount;
      runnerInstanceCreationFailureCount += missingCount;
      runnerInstanceCreationFailureReason ??= `Runner instance creation returned ${created.runner_instances.length} of ${batch.length} requested instances.`;
    }

    for (const [index, createdRunner] of created.runner_instances.entries()) {
      if (deps.signal?.aborted) break;
      const plannedRunner = batch[index];
      if (!plannedRunner) continue;
      const template = templateById.get(plannedRunner.providerRunnerId);
      if (!template) continue;

      deps.tracker.recordStarting({
        providerRunnerId: plannedRunner.providerRunnerId,
        templateKey: template.key,
      });
      attempted += 1;
      try {
        const outcome = (await deps.launch({
          runnerInstanceId: createdRunner.runner_instance_id,
          providerRunnerId: plannedRunner.providerRunnerId,
          ...(reservationId ? {reservationId} : {}),
          template,
          bootstrapToken: createdRunner.bootstrap_token,
          runnerEnv: deps.buildRunnerEnv({
            template,
            bootstrapToken: createdRunner.bootstrap_token,
          }),
        })) ?? {containerStarted: true, identityAttached: true, reported: true};
        if (!outcome.containerStarted) {
          providerLaunchFailureCount += 1;
          deps.tracker.remove(plannedRunner.providerRunnerId);
          providerLaunchFailureReason ??= launchLifecycleFailureReason(outcome);
          continue;
        }
        launched += 1;
        if (!outcome.identityAttached || !outcome.reported) {
          launchLifecycleIncompleteCount += 1;
          launchLifecycleIncompleteReason ??= launchLifecycleFailureReason(outcome);
        }
      } catch (error) {
        providerLaunchFailureCount += 1;
        // The launch call rejected, so no resource was created: free the slot now instead
        // of leaving a phantom `starting` runner. A persistent failure (bad image, daemon
        // down) would otherwise drain capacity to zero and wedge the loop until restart.
        deps.tracker.remove(plannedRunner.providerRunnerId);
        if (error instanceof ProvisionerAuthenticationError) throw error;
        providerLaunchFailureReason ??= launchFailureReason(error);
      }
    }
  }

  return {
    attempted,
    launched,
    runnerInstanceCreationFailureCount,
    ...(runnerInstanceCreationFailureReason ? {runnerInstanceCreationFailureReason} : {}),
    providerLaunchFailureCount,
    ...(providerLaunchFailureReason ? {providerLaunchFailureReason} : {}),
    launchLifecycleIncompleteCount,
    ...(launchLifecycleIncompleteReason ? {launchLifecycleIncompleteReason} : {}),
  };
}

function instanceCreationFailureReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
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
