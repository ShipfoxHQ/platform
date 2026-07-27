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
import {type RunnerEnvFactory, runProvisionerTick} from '#tick.js';
import {createInMemoryTracker, type ProviderRunnerTracker} from '#tracker.js';
import type {ProvisionerAdapter, ProvisionerTemplate} from '#types.js';

/** The demand poll accepts at most 1000 advertised templates per request. */
const MAX_TEMPLATES_PER_POLL = 1000;
const CONFIG_SAMPLE_LIMIT = 20;

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
}

export interface RunProvisionerIterationResult {
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

  const providerConfiguration = (await options.adapter.onConfigure?.({templates})) ?? {};
  logger().info(
    {
      event: 'provisioner.configured',
      templateCount: templates.length,
      templateKeySample: templates.slice(0, CONFIG_SAMPLE_LIMIT).map((template) => template.key),
      ...providerConfiguration,
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

  let currentInterval = config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS;
  while (running) {
    pollAbortController = new AbortController();
    try {
      const iteration = await runProvisionerIteration({
        adapter: options.adapter,
        client,
        templates,
        tracker,
        currentInterval,
        health,
        signal: pollAbortController.signal,
      });
      currentInterval = iteration.nextInterval;
      await interruptableSleep(withJitter(currentInterval));
    } catch {
      if (!running) break;
      currentInterval = nextBackoffInterval(currentInterval);
      await interruptableSleep(withJitter(currentInterval));
    }
  }

  await options.adapter.onStop?.();
  logger().info({event: 'provisioner.stopped'}, 'Provisioner stopped');
}

export async function runProvisionerIteration<Spec>(
  deps: RunProvisionerIterationDeps<Spec>,
): Promise<RunProvisionerIterationResult> {
  const health = deps.health ?? createHealthState();
  let derived = healthDerived(health);
  let observed = false;
  if (deps.adapter.onTick) {
    try {
      await deps.adapter.onTick();
      applyHealthEvent(health, {
        type: 'facet_recovered',
        facet: 'provider_observation',
        at: new Date(),
      });
      observed = true;
      derived = healthDerived(health);
    } catch (error) {
      if (deps.signal?.aborted) throw error;
      applyHealthEvent(health, {
        type: 'facet_failed',
        facet: 'provider_observation',
        cause: errorReason(error),
        impact: 'capacity',
        at: new Date(),
      });
      derived = healthDerived(health);
    }
  }
  const reservationLimit = config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS;
  const launchBudget = deriveLaunchBudget(health);

  let result: Awaited<ReturnType<typeof runProvisionerTick>>;
  try {
    result = await runProvisionerTick({
      client: deps.client,
      templates: deps.templates,
      tracker: deps.tracker,
      launch: deps.adapter.launch,
      ...(deps.adapter.terminate ? {terminate: deps.adapter.terminate} : {}),
      buildRunnerEnv,
      reservationLimit,
      launchBudget,
      waitSeconds: config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS,
      runnerInstanceBatchSize: config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE,
      retryIntervalMs: deps.currentInterval,
      ...(deps.signal ? {signal: deps.signal} : {}),
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

  derived = healthDerived(health);
  if (observed || result.launchedCount > 0) {
    applyHealthEvent(health, {type: 'ready_confirmed', at: new Date()});
    derived = healthDerived(health);
  }

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
