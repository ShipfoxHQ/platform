import {
  MAX_RECONCILE_OBSERVED_RUNNERS,
  type RunnerInstanceReportEventDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerIdentity,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {buildContainerLabels, parseContainerIdentity} from '#container-identity.js';
import {type DockerContainerView, type DockerEngine, DockerEngineError} from '#docker-engine.js';
import {parseMemoryToBytes} from '#memory.js';
import type {DockerTemplateSpec} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_PENDING_REPORTS = 5000;
const MAX_REASON_LENGTH = 500;
const REPORT_BACKLOG_LOG_EVERY_PASSES = 5;
const EMPTY_TERMINATE_INTENT_IDS = new Set<string>();

type TrackerSeed = {
  providerRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

export interface DockerLifecycle {
  launch(launch: ProviderRunnerLaunch<DockerTemplateSpec>): Promise<void>;
  observe(): Promise<void>;
  reconcile(): Promise<void>;
  tick(): Promise<void>;
  terminate(providerRunnerIds: readonly string[]): Promise<void>;
  flush(): Promise<void>;
}

interface DockerLifecycleOptions {
  engine: DockerEngine;
  client: ProvisionerClient;
  identity: ProvisionerIdentity;
  tracker: ProviderRunnerTracker;
  templates: readonly ProvisionerTemplate<DockerTemplateSpec>[];
  now?: () => Date;
  registrationDeadlineMs: number;
  providerKind: string;
}

interface DockerLifecycleContext {
  readonly engine: DockerEngine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
  readonly templatesByKey: ReadonlyMap<string, ProvisionerTemplate<DockerTemplateSpec>>;
  readonly now: () => Date;
  readonly registrationDeadlineMs: number;
  readonly providerKind: string;
  readonly knownLiveIds: Set<string>;
  readonly knownTemplateKeys: Map<string, string>;
  readonly pendingReports: RunnerInstanceReportEventDto[];
  backendReconcileSucceeded: boolean;
  reportBacklogPasses: number;
}

interface ObservationPlan {
  readonly trackerRunners: TrackerSeed[];
  readonly liveEvents: RunnerInstanceReportEventDto[];
  readonly assignmentCandidates: Array<{reservationId: string; runnerInstanceId: string}>;
  readonly terminalActions: TerminalAction[];
}

interface TerminalAction {
  readonly providerRunnerId: string;
  readonly event?: RunnerInstanceReportEventDto;
  readonly remove?: string;
  readonly killAndRemove?: string;
}

type LiveContainerState = {
  state: 'starting' | 'running';
  reason?: string;
};
type ParsedContainerIdentity = ReturnType<typeof parseContainerIdentity>;

export function createDockerLifecycle(args: DockerLifecycleOptions): DockerLifecycle {
  const now = args.now ?? (() => new Date());
  const context: DockerLifecycleContext = {
    engine: args.engine,
    client: args.client,
    identity: args.identity,
    tracker: args.tracker,
    templatesByKey: new Map(args.templates.map((template) => [template.key, template])),
    now,
    registrationDeadlineMs: args.registrationDeadlineMs,
    providerKind: args.providerKind,
    knownLiveIds: new Set<string>(),
    knownTemplateKeys: new Map<string, string>(),
    pendingReports: [],
    backendReconcileSucceeded: false,
    reportBacklogPasses: 0,
  };

  return {
    launch: (runner) => launch(context, runner),
    observe: () => observe(context),
    reconcile: () => reconcile(context),
    tick: () => tick(context),
    terminate: (ids) => terminate(context, ids),
    flush: () => flush(context),
  };
}

async function launch(
  context: DockerLifecycleContext,
  runner: ProviderRunnerLaunch<DockerTemplateSpec>,
): Promise<void> {
  const labels = buildContainerLabels({launch: runner, identity: context.identity});

  try {
    await context.engine.createAndStart({
      name: runner.providerRunnerId,
      image: runner.template.spec.image,
      env: {
        ...runner.runnerEnv,
        SHIPFOX_RUNNER_PROVIDER_KIND: context.providerKind,
      },
      labels,
      nanoCpus: Math.round(runner.template.spec.cpu * 1_000_000_000),
      memoryBytes: parseMemoryToBytes(runner.template.spec.memory),
    });
    const attachRunnerInstanceProviderId = context.client.attachRunnerInstanceProviderId;
    if (!attachRunnerInstanceProviderId)
      throw new Error(
        'Provisioner client does not support runner-instance provider identity attachment',
      );
    const result = await attachRunnerInstanceProviderId(
      runner.runnerInstanceId,
      runner.providerRunnerId,
    );
    if (!result.attached) {
      throw new Error(
        `Provider identity was not attached for runner instance ${runner.runnerInstanceId}`,
      );
    }
    await reportEvents(context, [
      {
        provider_runner_id: runner.providerRunnerId,
        template_key: runner.template.key,
        labels: [...runner.template.labels],
        state: 'starting',
        reported_at: context.now().toISOString(),
        provider_kind: context.providerKind,
      },
    ]);
    context.knownLiveIds.add(runner.providerRunnerId);
    context.knownTemplateKeys.set(runner.providerRunnerId, runner.template.key);
  } catch (error) {
    // Preserve the pre-created instance as the lifecycle record even when launch fails.
    // The provider ID is still the stable idempotency key for the failed launch attempt.
    try {
      await context.client.attachRunnerInstanceProviderId(
        runner.runnerInstanceId,
        runner.providerRunnerId,
      );
    } catch (attachError) {
      logger().warn(
        {err: attachError, runnerInstanceId: runner.runnerInstanceId},
        'Failed to attach provider identity after runner launch failure',
      );
    }
    await reportEvents(context, [
      {
        provider_runner_id: runner.providerRunnerId,
        template_key: runner.template.key,
        labels: [...runner.template.labels],
        state: 'failed',
        reason: truncateReason(errorReason(error)),
        reported_at: context.now().toISOString(),
        provider_kind: context.providerKind,
      },
    ]);
    throw error;
  }
}

async function observe(context: DockerLifecycleContext): Promise<void> {
  await reportEvents(context, []);
  const containers = await context.engine.listManaged(context.identity.id);
  await applyObservedContainers(context, containers, EMPTY_TERMINATE_INTENT_IDS);
}

async function reconcile(context: DockerLifecycleContext): Promise<void> {
  await reportEvents(context, []);
  const containers = await context.engine.listManaged(context.identity.id);
  const observedProviderRunnerIds = observedRunnerIds(containers);
  if (observedProviderRunnerIds.length > MAX_RECONCILE_OBSERVED_RUNNERS) {
    logger().error(
      {
        observedCount: observedProviderRunnerIds.length,
        maxObserved: MAX_RECONCILE_OBSERVED_RUNNERS,
      },
      'Skipping backend reconcile because observed provisioned runner count exceeds the API limit',
    );
    await applyObservedContainers(context, containers, EMPTY_TERMINATE_INTENT_IDS);
    return;
  }

  const response = await context.client.reconcileRunnerInstances({
    observed_provider_runner_ids: observedProviderRunnerIds,
  });
  const terminateIntentIds = new Set(
    response.runners
      .filter((runner) => runner.desired_intent === 'terminate')
      .map((runner) => runner.provider_runner_id),
  );

  if (response.terminated_absent_provider_runner_ids.length > 0) {
    logger().info(
      {providerRunnerIds: response.terminated_absent_provider_runner_ids},
      'Backend terminated provisioned runners absent from Docker',
    );
  }

  await applyObservedContainers(context, containers, terminateIntentIds);
  context.backendReconcileSucceeded = true;
}

async function tick(context: DockerLifecycleContext): Promise<void> {
  if (context.backendReconcileSucceeded) {
    await observe(context);
    return;
  }

  await reconcile(context);
}

async function terminate(
  context: DockerLifecycleContext,
  providerRunnerIds: readonly string[],
): Promise<void> {
  if (providerRunnerIds.length === 0) return;

  const ids = new Set(providerRunnerIds);
  const containers = await context.engine.listManaged(context.identity.id);
  const actions = containers.flatMap((container) => {
    const parsed = parseContainerIdentity(container);
    return ids.has(parsed.providerRunnerId)
      ? [terminalActionFor(context, container, 'backend-terminate')]
      : [];
  });

  await applyTerminalActions(context, actions);
}

function buildObservationPlan(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
  terminateIntentIds: ReadonlySet<string>,
): ObservationPlan {
  const listedIds = new Set<string>();
  const plan: ObservationPlan = {
    trackerRunners: [],
    liveEvents: [],
    assignmentCandidates: [],
    terminalActions: [],
  };

  for (const container of containers) {
    recordContainerObservation(context, plan, listedIds, container, terminateIntentIds);
  }
  synthesizeVanishedContainers(context, plan, listedIds);

  return plan;
}

function recordContainerObservation(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  listedIds: Set<string>,
  container: DockerContainerView,
  terminateIntentIds: ReadonlySet<string>,
): void {
  const parsed = parseContainerIdentity(container);
  listedIds.add(parsed.providerRunnerId);
  if (terminateIntentIds.has(parsed.providerRunnerId)) {
    plan.terminalActions.push(terminalActionFor(context, container, 'backend-terminate'));
    return;
  }

  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logger().warn(
      {providerRunnerId: parsed.providerRunnerId},
      'Skipping provisioned runner report because labels are unavailable',
    );
    return;
  }

  if (
    container.state === 'created' &&
    isPastDeadline(container.createdAt, context.now(), context.registrationDeadlineMs)
  ) {
    plan.terminalActions.push(terminalActionFor(context, container, 'registration-deadline'));
    return;
  }

  const mapped = mapContainerState(container);
  if (mapped.state === 'starting' || mapped.state === 'running') {
    const liveState: LiveContainerState = {
      state: mapped.state,
      ...(mapped.reason ? {reason: mapped.reason} : {}),
    };
    recordLiveContainer(context, plan, container, parsed, labels, liveState);
    return;
  }

  if (mapped.state === 'failed') {
    logger().error(
      {
        providerRunnerId: parsed.providerRunnerId,
        ...(parsed.runnerInstanceId ? {runnerInstanceId: parsed.runnerInstanceId} : {}),
        containerId: container.id,
        containerName: container.name,
        exitCode: container.exitCode ?? null,
        oomKilled: container.oomKilled ?? false,
        reason: mapped.reason,
      },
      'Provisioned runner container exited unsuccessfully',
    );
  }

  plan.terminalActions.push({
    providerRunnerId: parsed.providerRunnerId,
    event: eventFor(
      container,
      mapped.state,
      labels,
      context.providerKind,
      context.now(),
      mapped.reason,
    ),
    remove: container.name,
  });
}

function recordLiveContainer(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  labels: readonly string[],
  mapped: LiveContainerState,
): void {
  context.knownLiveIds.add(parsed.providerRunnerId);
  if (parsed.templateKey) {
    context.knownTemplateKeys.set(parsed.providerRunnerId, parsed.templateKey);
  }
  plan.liveEvents.push(
    eventFor(container, mapped.state, labels, context.providerKind, context.now(), mapped.reason),
  );
  if (parsed.runnerInstanceId && parsed.reservationId) {
    plan.assignmentCandidates.push({
      runnerInstanceId: parsed.runnerInstanceId,
      reservationId: parsed.reservationId,
    });
  }
  if (parsed.templateKey) {
    plan.trackerRunners.push({
      providerRunnerId: parsed.providerRunnerId,
      templateKey: parsed.templateKey,
      state: mapped.state,
    });
  }
}

function synthesizeVanishedContainers(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  listedIds: ReadonlySet<string>,
): void {
  for (const providerRunnerId of [...context.knownLiveIds]) {
    if (listedIds.has(providerRunnerId)) continue;
    context.knownLiveIds.delete(providerRunnerId);
    const templateKey = context.knownTemplateKeys.get(providerRunnerId);
    context.knownTemplateKeys.delete(providerRunnerId);
    const template = templateKey ? context.templatesByKey.get(templateKey) : undefined;
    if (!template) continue;
    plan.terminalActions.push({
      providerRunnerId,
      event: {
        provider_runner_id: providerRunnerId,
        template_key: template.key,
        labels: [...template.labels],
        state: 'terminated',
        reported_at: context.now().toISOString(),
        provider_kind: context.providerKind,
      },
    });
  }
}

async function applyObservationPlan(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
): Promise<void> {
  context.tracker.replaceAll(plan.trackerRunners);
  await assignEnrolledReservations(context, plan);
  if (plan.liveEvents.length > 0) await reportEvents(context, plan.liveEvents);
  await applyTerminalActions(context, plan.terminalActions);
}

async function assignEnrolledReservations(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
): Promise<void> {
  const assignments = new Map<string, string[]>();
  for (const {reservationId, runnerInstanceId} of plan.assignmentCandidates) {
    const runnerInstanceIds = assignments.get(reservationId) ?? [];
    runnerInstanceIds.push(runnerInstanceId);
    assignments.set(reservationId, runnerInstanceIds);
  }
  for (const [reservationId, runnerInstanceIds] of assignments) {
    try {
      await context.client.assignRunnerInstances(reservationId, runnerInstanceIds);
    } catch (error) {
      if (responseStatus(error) !== 409) throw error;
    }
  }
}

async function applyObservedContainers(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
  terminateIntentIds: ReadonlySet<string>,
): Promise<void> {
  await applyObservationPlan(
    context,
    buildObservationPlan(context, containers, terminateIntentIds),
  );
  reportBacklogIfNeeded(context);
}

async function applyTerminalActions(
  context: DockerLifecycleContext,
  actions: readonly TerminalAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.killAndRemove) await context.engine.killAndRemove(action.killAndRemove);
    if (action.remove) await context.engine.remove(action.remove);
    if (action.event) await reportEvents(context, [action.event]);
    context.knownLiveIds.delete(action.providerRunnerId);
    context.knownTemplateKeys.delete(action.providerRunnerId);
    context.tracker.remove(action.providerRunnerId);
  }
}

async function reportEvents(
  context: DockerLifecycleContext,
  events: readonly RunnerInstanceReportEventDto[],
): Promise<void> {
  const queued = context.pendingReports.splice(0);
  const reports = [...queued, ...events];
  if (reports.length === 0) return;

  const batches = chunk(reports, MAX_REPORT_BATCH);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] ?? [];
    try {
      await context.client.reportRunnerInstances({events: batch});
    } catch (error) {
      if (error instanceof ProvisionerAuthenticationError) {
        bufferReports(context, [...batch, ...batches.slice(index + 1).flat()]);
        throw error;
      }
      if (isPermanentReportError(error)) {
        logger().error(
          {err: error, count: batch.length},
          'Dropping invalid provisioned runner report batch',
        );
        continue;
      }
      const unsent = [...batch, ...batches.slice(index + 1).flat()];
      bufferReports(context, unsent);
      return;
    }
  }
}

async function flush(context: DockerLifecycleContext): Promise<void> {
  try {
    await reportEvents(context, []);
  } catch (error) {
    logger().error({err: error}, 'Failed to flush provisioned runner reports on shutdown');
  }
}

function terminalActionFor(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  reason: string,
): TerminalAction {
  const parsed = parseContainerIdentity(container);
  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logger().warn(
      {providerRunnerId: parsed.providerRunnerId},
      'Skipping provisioned runner report because labels are unavailable',
    );
    return {
      providerRunnerId: parsed.providerRunnerId,
      killAndRemove: container.name,
    };
  }

  return {
    ...(parsed.runnerInstanceId ? {runner_instance_id: parsed.runnerInstanceId} : {}),
    providerRunnerId: parsed.providerRunnerId,
    event: eventFor(container, 'terminated', labels, context.providerKind, context.now(), reason),
    killAndRemove: container.name,
  };
}

function observedRunnerIds(containers: readonly DockerContainerView[]): string[] {
  return [
    ...new Set(containers.map((container) => parseContainerIdentity(container).providerRunnerId)),
  ];
}

function bufferReports(
  context: DockerLifecycleContext,
  events: readonly RunnerInstanceReportEventDto[],
): void {
  context.pendingReports.push(...events);
  if (context.pendingReports.length <= MAX_PENDING_REPORTS) return;

  const overflow = context.pendingReports.length - MAX_PENDING_REPORTS;
  let dropped = 0;
  for (let index = 0; index < context.pendingReports.length && dropped < overflow; ) {
    const event = context.pendingReports[index];
    if (event && !isTerminalReportEvent(event)) {
      context.pendingReports.splice(index, 1);
      dropped += 1;
      continue;
    }
    index += 1;
  }
  if (dropped < overflow) {
    const remaining = overflow - dropped;
    context.pendingReports.splice(0, remaining);
    dropped += remaining;
  }

  if (dropped > 0) {
    logger().warn(
      {dropped, pending: context.pendingReports.length},
      'Dropped buffered provisioned runner reports after retry queue overflow',
    );
  }
}

function reportBacklogIfNeeded(context: DockerLifecycleContext): void {
  if (context.pendingReports.length === 0) {
    context.reportBacklogPasses = 0;
    return;
  }

  context.reportBacklogPasses += 1;
  if (
    context.reportBacklogPasses === 2 ||
    context.reportBacklogPasses % REPORT_BACKLOG_LOG_EVERY_PASSES === 0
  ) {
    logger().error(
      {pending: context.pendingReports.length},
      'Provisioned-runner reports backing up',
    );
  }
}

function isTerminalReportEvent(event: RunnerInstanceReportEventDto): boolean {
  return event.state === 'stopped' || event.state === 'failed' || event.state === 'terminated';
}

function isPermanentReportError(error: unknown): boolean {
  return responseStatus(error) === 400;
}

function responseStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const response = (error as Error & {response?: {status?: unknown}}).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

function labelsFor(
  context: DockerLifecycleContext,
  templateKey: string | undefined,
  labels: readonly string[],
): readonly string[] {
  if (labels.length > 0) return labels;
  return templateKey ? (context.templatesByKey.get(templateKey)?.labels ?? []) : [];
}

function eventFor(
  container: DockerContainerView,
  state: RunnerInstanceReportEventDto['state'],
  labels: readonly string[],
  providerKind: string,
  reportedAt: Date,
  reason?: string,
): RunnerInstanceReportEventDto {
  const parsed = parseContainerIdentity(container);
  return {
    ...(parsed.runnerInstanceId ? {runner_instance_id: parsed.runnerInstanceId} : {}),
    provider_runner_id: parsed.providerRunnerId,
    ...(parsed.templateKey ? {template_key: parsed.templateKey} : {}),
    labels: [...labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: reportedAt.toISOString(),
    provider_kind: providerKind,
  };
}

function mapContainerState(container: DockerContainerView): {
  state: RunnerInstanceReportEventDto['state'];
  reason?: string;
} {
  switch (container.state) {
    case 'created':
      return {state: 'starting'};
    case 'running':
    case 'paused':
    case 'restarting':
      return {state: 'running'};
    case 'exited':
      if (container.oomKilled) return {state: 'failed', reason: 'oom'};
      return container.exitCode === 0
        ? {state: 'stopped'}
        : {state: 'failed', reason: `exit-code-${container.exitCode ?? 'unknown'}`};
    case 'dead':
    case 'removing':
      return {state: 'terminated'};
    default:
      return {state: 'running', reason: `docker-state-${container.state}`};
  }
}

function isPastDeadline(createdAt: Date, now: Date, deadlineMs: number): boolean {
  return now.getTime() - createdAt.getTime() > deadlineMs;
}

function errorReason(error: unknown): string {
  if (error instanceof DockerEngineError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

function truncateReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
