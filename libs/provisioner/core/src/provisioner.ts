import {logger} from '@shipfox/node-opentelemetry';
import {
  withJitter as applyJitter,
  nextBackoffInterval as calculateNextBackoffInterval,
  createGracefulShutdownController,
  interruptibleSleep,
} from '@shipfox/node-resilient-loop';
import {
  createProvisionerClient,
  ProvisionerAuthenticationError,
  type ProvisionerClient,
} from '#api-client.js';
import {config} from '#config.js';
import {
  createHealthState,
  deriveHealth,
  type HealthEvent,
  type HealthFacet,
  type HealthLog,
  type HealthState,
  reduceHealth,
} from '#health.js';
import {type ProviderPass, type RunnerEnvFactory, runProvisionerTick} from '#tick.js';
import {createInMemoryTracker, type ProviderRunnerTracker} from '#tracker.js';
import type {ProvisionerAdapter, ProvisionerTemplate, TerminateRunners} from '#types.js';

/** The demand poll accepts at most 1000 advertised templates per request. */
const MAX_TEMPLATES_PER_POLL = 1000;
const CONFIG_SAMPLE_LIMIT = 20;
const CONVERGE_BACKOFF_FLOOR_MS = 5000;
const TERMINATION_DRAIN_TIMEOUT_MS = 1000;

let running = true;
let pollAbortController: AbortController | undefined;
const shutdownController = createGracefulShutdownController({
  onFirstSignal: (signal) => {
    running = false;
    logger().info({event: 'provisioner.stopping', signal}, 'Provisioner shutting down gracefully');
    pollAbortController?.abort('shutdown');
  },
  onSecondSignal: (signal) => {
    logger().info({event: 'provisioner.stopping', signal, forced: true}, 'Provisioner exiting now');
    process.exit(1);
  },
});

export type ProvisionerHealthState = HealthState;

export interface StartProvisionerOptions<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
}

export interface RunProvisionerIterationDeps<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProviderRunnerTracker;
  readonly currentInterval: number;
  readonly health?: ProvisionerHealthState;
  readonly signal?: AbortSignal;
  readonly withProviderLock?: ProviderPass;
  readonly deferTermination?: TerminateRunners;
}

export interface RunProvisionerIterationResult {
  readonly nextInterval: number;
  readonly degraded: boolean;
}

export interface RunConvergeIterationDeps<Spec> {
  readonly adapter: ProvisionerAdapter<Spec>;
  readonly currentInterval: number;
  readonly baseInterval: number;
  readonly health?: ProvisionerHealthState;
  readonly signal?: AbortSignal;
  readonly withProviderLock?: ProviderPass;
  readonly takeTerminationIntents?: () => readonly string[];
  readonly requeueTerminationIntents?: (providerRunnerIds: readonly string[]) => void;
}

export interface RunConvergeIterationResult {
  readonly nextInterval: number;
  readonly degraded: boolean;
}

/**
 * Run the provisioner control loop until shutdown. Health transitions are reduced from
 * typed operation outcomes; adapters do not own readiness, backoff, or suppression state.
 */
export async function startProvisioner<Spec>(
  options: StartProvisionerOptions<Spec>,
): Promise<void> {
  running = true;
  shutdownController.reset();
  shutdownController.start();

  const templates = await options.adapter.loadTemplates();
  if (templates.length === 0) {
    throw new Error('Provisioner started with no templates; configure at least one template.');
  }
  if (templates.length > MAX_TEMPLATES_PER_POLL) {
    throw new Error(
      `Provisioner has ${templates.length} templates; the demand poll accepts at most ${MAX_TEMPLATES_PER_POLL}. Reduce the configured templates.`,
    );
  }
  if (
    options.adapter.reservationTtlSeconds !== undefined &&
    (!Number.isInteger(options.adapter.reservationTtlSeconds) ||
      options.adapter.reservationTtlSeconds < 1)
  ) {
    throw new Error(
      `Provisioner adapter reservationTtlSeconds is ${options.adapter.reservationTtlSeconds}; the demand poll accepts a whole number of seconds of at least 1. Set a positive integer.`,
    );
  }

  const providerConfiguration = (await options.adapter.onConfigure?.({templates})) ?? {};
  logger().info(
    {
      ...providerConfiguration,
      event: 'provisioner.configured',
      templateCount: templates.length,
      templateKeySample: templates.slice(0, CONFIG_SAMPLE_LIMIT).map((template) => template.key),
    },
    'Provisioner configured',
  );

  const client = createProvisionerClient({
    baseUrl: config.SHIPFOX_API_URL,
    token: config.SHIPFOX_PROVISIONER_TOKEN,
  });

  let identity: Awaited<ReturnType<ProvisionerClient['getIdentity']>>;
  try {
    identity = await client.getIdentity();
  } catch (error) {
    if (error instanceof ProvisionerAuthenticationError) {
      logger().error(
        {
          event: 'provisioner.authentication_failed',
          operation: error.action,
          status: error.status,
          reason: 'token_rejected',
        },
        `Provisioner token rejected during ${error.action}`,
      );
    }
    throw error;
  }
  logger().info(
    {
      event: 'provisioner.authenticated',
      provisionerId: identity.id,
      workspaceId: identity.scope === 'workspace' ? identity.workspace_id : undefined,
      scope: identity.scope,
      templateCount: templates.length,
    },
    'Provisioner authenticated',
  );

  const tracker = createInMemoryTracker();
  const health = createHealthState();
  try {
    await options.adapter.onStart?.({
      client,
      identity: {
        id: identity.id,
        workspaceId: identity.scope === 'workspace' ? identity.workspace_id : null,
        scope: identity.scope,
      },
      tracker,
    });
    applyHealthEvent(health, {type: 'ready_confirmed', at: new Date()});
  } catch (error) {
    applyHealthEvent(health, {
      type: 'facet_failed',
      facet: 'provider_observation',
      cause: errorReason(error),
      impact: 'capacity',
      at: new Date(),
    });
  }

  const withProviderLock = createProviderMutex();
  const terminationQueue = createTerminationQueue();
  const deferTermination = options.adapter.terminate
    ? (providerRunnerIds: readonly string[]) => {
        terminationQueue.replace(providerRunnerIds);
        return Promise.resolve();
      }
    : undefined;
  const loops = [
    runDemandLoop({
      adapter: options.adapter,
      client,
      templates,
      tracker,
      health,
      withProviderLock,
      ...(deferTermination ? {deferTermination} : {}),
    }),
    runConvergeLoop({
      adapter: options.adapter,
      health,
      baseInterval: config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS,
      withProviderLock,
      takeTerminationIntents: () => terminationQueue.take(),
      requeueTerminationIntents: (providerRunnerIds) => terminationQueue.requeue(providerRunnerIds),
    }),
  ];

  try {
    await Promise.all(loops);
  } finally {
    running = false;
    pollAbortController?.abort('shutdown');
    await Promise.allSettled(loops);
    try {
      await drainTerminationQueue(options.adapter, () => terminationQueue.take());
      await options.adapter.onStop?.();
    } finally {
      shutdownController.stop();
    }
  }
  logger().info({event: 'provisioner.stopped'}, 'Provisioner stopped');
}

export async function runProvisionerIteration<Spec>(
  deps: RunProvisionerIterationDeps<Spec>,
): Promise<RunProvisionerIterationResult> {
  const health = deps.health ?? createHealthState();
  const withProviderLock = deps.withProviderLock ?? createProviderMutex();
  await runConvergeIteration({
    adapter: deps.adapter,
    currentInterval: config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS,
    baseInterval: config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS,
    health,
    ...(deps.signal ? {signal: deps.signal} : {}),
    withProviderLock,
  });
  return runDemandIteration({...deps, health, withProviderLock});
}

export async function runConvergeIteration<Spec>(
  deps: RunConvergeIterationDeps<Spec>,
): Promise<RunConvergeIterationResult> {
  const health = deps.health ?? createHealthState();

  let failed = false;
  const withProviderLock = deps.withProviderLock ?? inlineProviderPass;
  await withProviderLock(async () => {
    if (deps.adapter.onTick) {
      try {
        await deps.adapter.onTick();
        applyHealthEvent(health, {
          type: 'facet_recovered',
          facet: 'provider_observation',
          at: new Date(),
        });
        applyHealthEvent(health, {type: 'ready_confirmed', at: new Date()});
      } catch (error) {
        if (deps.signal?.aborted) throw error;
        failed = true;
        applyHealthEvent(health, {
          type: 'facet_failed',
          facet: 'provider_observation',
          cause: errorReason(error),
          impact: 'capacity',
          at: new Date(),
        });
      }
    }

    // Only take intents a pass can actually act on; taking them without a terminate
    // port would drop them, since take() clears the queue.
    if (!deps.adapter.terminate) return;
    const terminationIntents = [...(deps.takeTerminationIntents?.() ?? [])];
    if (terminationIntents.length === 0) return;
    try {
      await deps.adapter.terminate(terminationIntents);
      applyHealthEvent(health, {
        type: 'facet_recovered',
        facet: 'provider_termination',
        at: new Date(),
      });
    } catch (error) {
      // Requeue before the abort rethrow: a terminate that fails during shutdown is
      // exactly the case where the intents must survive into the next pass.
      deps.requeueTerminationIntents?.(terminationIntents);
      if (deps.signal?.aborted) throw error;
      failed = true;
      applyHealthEvent(health, {
        type: 'facet_failed',
        facet: 'provider_termination',
        cause: errorReason(error),
        impact: 'cleanup',
        at: new Date(),
      });
    }
  });

  const derived = healthDerived(health);
  return {
    nextInterval: failed
      ? nextConvergeInterval(deps.currentInterval, deps.baseInterval)
      : deps.baseInterval,
    degraded: derived.capacityDegraded,
  };
}

export async function runDemandIteration<Spec>(
  deps: RunProvisionerIterationDeps<Spec>,
): Promise<RunProvisionerIterationResult> {
  const health = deps.health ?? createHealthState();
  const launchBudget = () => deriveLaunchBudget(health);

  const reservationLimit = config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS;

  let result: Awaited<ReturnType<typeof runProvisionerTick>>;
  try {
    result = await runProvisionerTick({
      client: deps.client,
      templates: deps.templates,
      tracker: deps.tracker,
      launch: deps.adapter.launch,
      ...(deps.deferTermination
        ? {terminate: deps.deferTermination}
        : deps.adapter.terminate
          ? {terminate: deps.adapter.terminate}
          : {}),
      ...(deps.adapter.reservationTtlSeconds !== undefined
        ? {reservationTtlSeconds: deps.adapter.reservationTtlSeconds}
        : {}),
      buildRunnerEnv,
      reservationLimit,
      launchBudget,
      waitSeconds: config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS,
      runnerInstanceBatchSize: config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE,
      retryIntervalMs: deps.currentInterval,
      ...(deps.signal ? {signal: deps.signal} : {}),
      ...(deps.withProviderLock ? {withProviderLock: deps.withProviderLock} : {}),
    });
    applyHealthEvent(health, {type: 'facet_recovered', facet: 'poll_demand', at: new Date()});
    applyHealthEvent(health, {type: 'facet_recovered', facet: 'authentication', at: new Date()});
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    const facet: HealthFacet =
      error instanceof ProvisionerAuthenticationError ? 'authentication' : 'poll_demand';
    applyHealthEvent(health, {
      type: 'facet_failed',
      facet,
      cause: errorReason(error),
      impact: 'control_plane',
      at: new Date(),
    });
    throw error;
  }
  deps.adapter.onDemandStats?.(result.stats);

  if (!deps.deferTermination) {
    if (result.providerTermination.status === 'failed') {
      applyHealthEvent(health, {
        type: 'facet_failed',
        facet: 'provider_termination',
        cause: result.providerTermination.cause,
        impact: 'cleanup',
        at: new Date(),
      });
    } else if (
      result.providerTermination.status === 'succeeded' ||
      result.providerTermination.status === 'not_needed'
    ) {
      applyHealthEvent(health, {
        type: 'facet_recovered',
        facet: 'provider_termination',
        at: new Date(),
      });
    }
  }

  const hasCapacityFailure =
    result.runnerInstanceCreationFailureCount > 0 ||
    result.providerLaunchFailureCount > 0 ||
    (result.launchAttemptedCount > 0 && result.launchedCount === 0);
  if (hasCapacityFailure) {
    applyHealthEvent(health, {
      type: 'facet_failed',
      facet: 'runner_capacity',
      cause:
        result.runnerInstanceCreationFailureReason ??
        result.providerLaunchFailureReason ??
        'All attempted runner launches failed.',
      impact: 'capacity',
      failureCount: result.runnerInstanceCreationFailureCount + result.providerLaunchFailureCount,
      at: new Date(),
    });
  } else if (result.launchedCount > 0) {
    applyHealthEvent(health, {type: 'facet_recovered', facet: 'runner_capacity', at: new Date()});
  }

  if (result.reservationConsumedOrStaleCount > 0) {
    logger().info(
      {
        event: 'runner.reservation_consumed_or_stale',
        skipped: result.reservationConsumedOrStaleCount,
      },
      'Runner reservation was consumed or stale; skipping unavailable launches',
    );
  }

  if (result.launchedCount > 0) {
    applyHealthEvent(health, {type: 'ready_confirmed', at: new Date()});
  }

  const derived = healthDerived(health);

  if (result.reservationCount > 0 || result.launchedCount > 0 || result.launchAttemptedCount > 0) {
    logger().info(
      {
        event: 'runner.launch_batch_completed',
        reserved: result.reservedRunnerCount,
        planned: result.plannedCount,
        attempted: result.launchAttemptedCount,
        started: result.launchedCount,
        failed: result.launchAttemptedCount - result.launchedCount,
        lifecycleIncomplete: result.launchLifecycleIncompleteCount,
        ...(result.launchLifecycleIncompleteReason
          ? {launchLifecycleIncompleteReason: result.launchLifecycleIncompleteReason}
          : {}),
        reservations: result.reservationCount,
      },
      'Runner launch batch completed',
    );
  }

  return {
    nextInterval: derived.shouldBackOff
      ? nextBackoffInterval(deps.currentInterval)
      : config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS,
    degraded: derived.capacityDegraded,
  };
}

/** Best-effort delivery for deferred terminations before the provider stops. */
export async function drainTerminationQueue<Spec>(
  adapter: ProvisionerAdapter<Spec>,
  takeTerminationIntents: () => readonly string[],
): Promise<void> {
  if (!adapter.terminate) return;
  const providerRunnerIds = [...takeTerminationIntents()];
  if (providerRunnerIds.length === 0) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    adapter.terminate(providerRunnerIds).then(
      () => 'completed' as const,
      (error: unknown) => {
        logger().warn(
          {
            event: 'provisioner.termination_drain_failed',
            providerRunnerCount: providerRunnerIds.length,
            reason: errorReason(error),
          },
          'Deferred provider terminations failed during shutdown',
        );
        return 'failed' as const;
      },
    ),
    new Promise<'timed_out'>((resolve) => {
      timeout = setTimeout(() => resolve('timed_out'), TERMINATION_DRAIN_TIMEOUT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);

  if (outcome === 'timed_out') {
    logger().warn(
      {
        event: 'provisioner.termination_drain_timed_out',
        providerRunnerCount: providerRunnerIds.length,
        timeoutMs: TERMINATION_DRAIN_TIMEOUT_MS,
      },
      'Deferred provider terminations did not complete before shutdown',
    );
  }
}

export const buildRunnerEnv: RunnerEnvFactory<unknown> = ({template, bootstrapToken}) => ({
  SHIPFOX_API_URL: config.SHIPFOX_RUNNER_API_URL ?? config.SHIPFOX_API_URL,
  SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
  SHIPFOX_RUNNER_LABELS: template.labels.join(','),
  SHIPFOX_POLL_MAX_DURATION_MS: String(config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS),
  SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: String(config.SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS),
});

export function nextBackoffInterval(ms: number): number {
  return calculateNextBackoffInterval(ms, {
    maxMs: config.SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS,
  });
}

export function withJitter(ms: number): number {
  return applyJitter(ms, {minFactor: 0.5});
}

async function interruptableSleep(ms: number): Promise<void> {
  if (!running) return;
  await interruptibleSleep(ms, shutdownController.signal);
}

async function runDemandLoop<Spec>(deps: {
  readonly adapter: ProvisionerAdapter<Spec>;
  readonly client: ProvisionerClient;
  readonly templates: readonly ProvisionerTemplate<Spec>[];
  readonly tracker: ProviderRunnerTracker;
  readonly health: ProvisionerHealthState;
  readonly withProviderLock: ProviderPass;
  readonly deferTermination?: TerminateRunners;
}): Promise<void> {
  let currentInterval = config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS;
  while (running) {
    const abortController = new AbortController();
    pollAbortController = abortController;
    try {
      const iteration = await runDemandIteration({
        adapter: deps.adapter,
        client: deps.client,
        templates: deps.templates,
        tracker: deps.tracker,
        currentInterval,
        health: deps.health,
        signal: abortController.signal,
        withProviderLock: deps.withProviderLock,
        ...(deps.deferTermination ? {deferTermination: deps.deferTermination} : {}),
      });
      currentInterval = iteration.nextInterval;
    } catch {
      if (!running) break;
      currentInterval = nextBackoffInterval(currentInterval);
    } finally {
      pollAbortController = undefined;
    }
    await interruptableSleep(withJitter(currentInterval));
  }
}

async function runConvergeLoop<Spec>(deps: {
  readonly adapter: ProvisionerAdapter<Spec>;
  readonly health: ProvisionerHealthState;
  readonly baseInterval: number;
  readonly withProviderLock: ProviderPass;
  readonly takeTerminationIntents: () => readonly string[];
  readonly requeueTerminationIntents: (providerRunnerIds: readonly string[]) => void;
}): Promise<void> {
  let currentInterval = deps.baseInterval;
  while (running) {
    try {
      const iteration = await runConvergeIteration({
        adapter: deps.adapter,
        currentInterval,
        baseInterval: deps.baseInterval,
        health: deps.health,
        signal: shutdownController.signal,
        withProviderLock: deps.withProviderLock,
        takeTerminationIntents: deps.takeTerminationIntents,
        requeueTerminationIntents: deps.requeueTerminationIntents,
      });
      currentInterval = iteration.nextInterval;
    } catch {
      if (!running) break;
      currentInterval = nextConvergeInterval(currentInterval, deps.baseInterval);
    }
    await interruptableSleep(withJitter(currentInterval));
  }
}

function nextConvergeInterval(currentInterval: number, baseInterval: number): number {
  return calculateNextBackoffInterval(currentInterval, {
    maxMs: Math.max(baseInterval, CONVERGE_BACKOFF_FLOOR_MS),
  });
}

function createProviderMutex(): ProviderPass {
  let previous = Promise.resolve();
  return async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const predecessor = previous;
    let release!: () => void;
    previous = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

const inlineProviderPass: ProviderPass = <Result>(operation: () => Promise<Result>) => operation();

export function createTerminationQueue(): {
  replace: TerminateRunners;
  requeue: (providerRunnerIds: readonly string[]) => void;
  take: () => readonly string[];
} {
  let pending = new Set<string>();
  return {
    replace(providerRunnerIds) {
      pending = new Set(providerRunnerIds);
      return Promise.resolve();
    },
    requeue(providerRunnerIds) {
      for (const providerRunnerId of providerRunnerIds) pending.add(providerRunnerId);
    },
    take() {
      const providerRunnerIds = [...pending];
      pending.clear();
      return providerRunnerIds;
    },
  };
}

function applyHealthEvent(state: HealthState, event: HealthEvent): void {
  const reduction = reduceHealth(state, event);
  state.active = reduction.state.active;
  state.incident = reduction.state.incident;
  state.hasEverBeenReady = reduction.state.hasEverBeenReady;
  for (const log of reduction.logs) emitHealthLog(log);
}

function healthDerived(state: HealthState) {
  return deriveHealth(state);
}

function deriveLaunchBudget(state: HealthState): number {
  if (state.active.has('provider_observation')) return 0;
  if (state.active.has('runner_capacity')) return 1;
  return Number.POSITIVE_INFINITY;
}
function emitHealthLog(log: HealthLog): void {
  const fields = {
    event: log.event,
    ...(log.facet ? {operation: log.facet} : {}),
    ...(log.cause ? {cause: log.cause} : {}),
    ...(log.changed ? {changed: true} : {}),
    ...(log.recoveredFacet ? {recoveredFacet: log.recoveredFacet} : {}),
    ...(log.remainingFacetCount !== undefined
      ? {remainingFacetCount: log.remainingFacetCount}
      : {}),
    ...(log.impact ? {impact: log.impact} : {}),
    ...(log.attempts !== undefined ? {attempts: log.attempts} : {}),
    ...(log.suppressed !== undefined ? {suppressed: log.suppressed} : {}),
    ...(log.outageDurationMs !== undefined ? {outageDurationMs: log.outageDurationMs} : {}),
    ...(isApiFacet(log.facet) ? {endpoint: safeEndpoint(config.SHIPFOX_API_URL)} : {}),
  };
  if (log.level === 'error') {
    logger().error(fields, healthMessage(log));
  } else if (log.level === 'warn') {
    logger().warn(fields, healthMessage(log));
  } else {
    logger().info(fields, healthMessage(log));
  }
}

function healthMessage(log: HealthLog): string {
  if (log.event === 'provisioner.recovered') return 'Provisioner recovered';
  if (log.event === 'provisioner.partially_recovered') {
    return `Provisioner partially recovered; ${log.remainingFacetCount ?? 0} failure facet(s) remain active`;
  }
  if (log.event === 'provisioner.ready') return 'Provisioner ready';
  if (log.impact === 'cleanup') return 'Provisioner degraded; cleanup is temporarily unavailable';
  if (log.impact === 'control_plane') {
    return 'Provisioner degraded; control-plane operations are temporarily unavailable';
  }
  return 'Provisioner degraded; capacity is temporarily unavailable';
}

function isApiFacet(facet: HealthFacet | undefined): boolean {
  return facet === 'poll_demand' || facet === 'authentication';
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

function safeEndpoint(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '<invalid-endpoint>';
  }
}
