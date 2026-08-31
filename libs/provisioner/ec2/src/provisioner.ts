import type {DemandStatDto} from '@shipfox/api-runners-dto';
import {
  type ProviderRunnerLaunch,
  type ProvisionerAdapter,
  type ProvisionerRuntime,
  type ProvisionerTemplate,
  startProvisioner,
} from '@shipfox/provisioner-core';
import {config} from '#config.js';
import {createEc2Engine, type Ec2Engine} from '#ec2-engine.js';
import {createEc2Lifecycle, type Ec2Lifecycle} from '#lifecycle.js';
import {registerEc2ServiceMetrics} from '#metrics/service.js';
import {type Ec2TemplateSpec, loadEc2Templates} from '#templates.js';
import {renderRunnerBootstrapUserData} from '#user-data.js';

export interface CreateEc2ProvisionerAdapterOptions {
  readonly engine: Ec2Engine;
  readonly templates: readonly ProvisionerTemplate<Ec2TemplateSpec>[];
  readonly registrationDeadlineMs: number;
  readonly launchHeadroomMs: number;
  readonly reconcileIntervalMs: number;
  readonly stoppingTimeoutMs?: number;
}

/**
 * Compose the EC2 engine and lifecycle into the provider adapter consumed by the
 * shared runner-instance provisioner runtime.
 */
export function createEc2ProvisionerAdapter(
  options: CreateEc2ProvisionerAdapterOptions,
): ProvisionerAdapter<Ec2TemplateSpec> {
  let lifecycle: Ec2Lifecycle | undefined;
  let lastDemandStats: readonly DemandStatDto[] = [];

  return {
    loadTemplates: () => Promise.resolve(options.templates),
    reservationTtlSeconds: reservationTtlSecondsFromLaunchBudget(
      options.registrationDeadlineMs,
      options.launchHeadroomMs,
    ),
    launch: (launch) => requireLifecycle(lifecycle).launch(launch),
    terminate: (ids) => requireLifecycle(lifecycle).terminate(ids),
    onDemandStats(stats) {
      lastDemandStats = stats.map((stat) => ({...stat, labels: [...stat.labels]}));
    },
    async onStart(runtime) {
      lastDemandStats = [];
      registerEc2ServiceMetrics({
        engine: options.engine,
        provisionerId: runtime.identity.id,
        templates: options.templates,
        getDemandStats: () => lastDemandStats,
      });
      lifecycle = createLifecycle(options, runtime);
      await lifecycle.reconcile();
    },
    onTick: () => requireLifecycle(lifecycle).tick(),
    onStop: () => lifecycle?.flush() ?? Promise.resolve(),
  };
}

/** Starts the EC2 provider with its local template and AWS configuration. */
export function startEc2Provisioner(): Promise<void> {
  const templates = loadEc2Templates(config.SHIPFOX_PROVISIONER_TEMPLATES_FILE);
  const engine = createEc2Engine({region: config.AWS_REGION});

  return startProvisioner({
    adapter: createEc2ProvisionerAdapter({
      engine,
      templates,
      registrationDeadlineMs: config.SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS,
      launchHeadroomMs: config.SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS,
      reconcileIntervalMs: config.SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS,
      stoppingTimeoutMs: config.SHIPFOX_PROVISIONER_EC2_STOPPING_TIMEOUT_MS,
    }),
  });
}

function reservationTtlSecondsFromLaunchBudget(
  registrationDeadlineMs: number,
  launchHeadroomMs: number,
): number {
  return Math.ceil((registrationDeadlineMs + launchHeadroomMs) / 1000);
}

function createLifecycle(
  options: CreateEc2ProvisionerAdapterOptions,
  runtime: ProvisionerRuntime,
): Ec2Lifecycle {
  return createEc2Lifecycle({
    engine: options.engine,
    client: runtime.client,
    identity: runtime.identity,
    tracker: runtime.tracker,
    templates: options.templates,
    registrationDeadlineMs: options.registrationDeadlineMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    ...(options.stoppingTimeoutMs === undefined
      ? {}
      : {stoppingTimeoutMs: options.stoppingTimeoutMs}),
    providerKind: 'ec2',
    renderUserData,
  });
}

function renderUserData(launch: ProviderRunnerLaunch<Ec2TemplateSpec>): string {
  return renderRunnerBootstrapUserData({
    apiUrl: requiredRunnerEnv(launch, 'SHIPFOX_API_URL'),
    bootstrapToken: launch.bootstrapToken,
    labels: launch.template.labels,
    pollMaxDurationMs: numericRunnerEnv(launch, 'SHIPFOX_POLL_MAX_DURATION_MS'),
    maxLifetimeSeconds: numericRunnerEnv(launch, 'SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS'),
    workspaceDeviceName: launch.template.spec.workspaceDeviceName,
  });
}

function requireLifecycle(lifecycle: Ec2Lifecycle | undefined): Ec2Lifecycle {
  if (!lifecycle) throw new Error('EC2 lifecycle has not been initialized.');
  return lifecycle;
}

function requiredRunnerEnv(launch: ProviderRunnerLaunch<Ec2TemplateSpec>, name: string): string {
  const value = launch.runnerEnv[name];
  if (!value) throw new Error(`EC2 runner environment is missing ${name}.`);
  return value;
}

function numericRunnerEnv(launch: ProviderRunnerLaunch<Ec2TemplateSpec>, name: string): number {
  const value = Number(requiredRunnerEnv(launch, name));
  if (!Number.isInteger(value)) throw new Error(`EC2 runner environment has invalid ${name}.`);
  return value;
}
