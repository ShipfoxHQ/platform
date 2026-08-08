import {
  MAX_RECONCILE_OBSERVED_RUNNERS,
  RESERVATION_EXPIRED_ERROR_CODE,
  type ReconcileRunnerInstancesResponseDto,
  RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE,
  type RunnerInstanceReportEventDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  HTTPError,
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerIdentity,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type Ec2Engine, Ec2EngineError, type Ec2InstanceView} from '#ec2-engine.js';
import {buildInstanceTags, parseInstanceIdentity} from '#instance-identity.js';
import {
  type Ec2TerminationReason,
  recordEc2Launch,
  recordEc2ReconcileAbsent,
  recordEc2Termination,
} from '#metrics/instance.js';
import type {Ec2TemplateSpec} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_REASON_LENGTH = 500;
// DescribeInstances can retain terminated instances for about an hour. Keep the marker
// for that long across a listing gap to cover eventual-consistency blips.
const TERMINAL_REPORT_ABSENCE_GRACE_MS = 60 * 60 * 1000;
const SPOT_INTERRUPTION_REASON =
  /spot|instance-terminated-by-price|instance-terminated-no-capacity/i;

type TrackerSeed = {
  providerRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

type LocallyLaunchedRunner = {
  runnerInstanceId: string;
  templateKey: string;
  launchedAt: Date;
};

type AssignmentCandidate = {
  reservationId: string;
  runnerInstanceId: string;
  observedReservationId?: string;
  canonicalReservationId?: string;
};

type TerminalReportInstanceIds = ReadonlyMap<RunnerInstanceReportEventDto, string>;

export interface Ec2Lifecycle {
  launch(launch: ProviderRunnerLaunch<Ec2TemplateSpec>): Promise<void>;
  observe(): Promise<void>;
  reconcile(): Promise<void>;
  tick(): Promise<void>;
  terminate(providerRunnerIds: readonly string[]): Promise<void>;
  flush(): Promise<void>;
}

export interface Ec2LifecycleOptions {
  readonly engine: Ec2Engine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
  readonly templates: readonly ProvisionerTemplate<Ec2TemplateSpec>[];
  readonly providerKind: string;
  readonly registrationDeadlineMs: number;
  readonly reconcileIntervalMs: number;
  readonly now?: () => Date;
  readonly renderUserData?: (launch: ProviderRunnerLaunch<Ec2TemplateSpec>) => string;
}

interface Ec2LifecycleContext {
  readonly engine: Ec2Engine;
  readonly client: ProvisionerClient;
  readonly identity: ProvisionerIdentity;
  readonly tracker: ProviderRunnerTracker;
  readonly templatesByKey: ReadonlyMap<string, ProvisionerTemplate<Ec2TemplateSpec>>;
  readonly providerKind: string;
  readonly registrationDeadlineMs: number;
  readonly reconcileIntervalMs: number;
  readonly now: () => Date;
  readonly renderUserData?: (launch: ProviderRunnerLaunch<Ec2TemplateSpec>) => string;
  readonly locallyLaunched: Map<string, LocallyLaunchedRunner>;
  readonly terminalReportedInstanceIds: Map<string, number>;
  // Keep successful actions across short listing gaps so eventual-consistency reads do not
  // repeat AWS calls or metrics.
  readonly terminationActionedInstanceIds: Map<string, number>;
  readonly pendingTerminalReportedInstanceIds: Set<string>;
  readonly terminalReportInstanceIdsByEvent: WeakMap<RunnerInstanceReportEventDto, string>;
  readonly pendingReports: RunnerInstanceReportEventDto[];
  readonly suppressedReservationRunnerIds: Map<string, Set<string>>;
  readonly canonicalReservationIdsByRunner: Map<string, string | null>;
  lastReconciledAt?: Date;
}

/**
 * Owns the EC2-facing half of the provisioner lifecycle. AWS observations replace
 * the local capacity view, except for newly launched instances that DescribeInstances
 * has not made visible yet.
 */
export function createEc2Lifecycle(options: Ec2LifecycleOptions): Ec2Lifecycle {
  const context: Ec2LifecycleContext = {
    engine: options.engine,
    client: options.client,
    identity: options.identity,
    tracker: options.tracker,
    templatesByKey: new Map(options.templates.map((template) => [template.key, template])),
    providerKind: options.providerKind,
    registrationDeadlineMs: options.registrationDeadlineMs,
    reconcileIntervalMs: options.reconcileIntervalMs,
    now: options.now ?? (() => new Date()),
    ...(options.renderUserData ? {renderUserData: options.renderUserData} : {}),
    locallyLaunched: new Map(),
    terminalReportedInstanceIds: new Map(),
    terminationActionedInstanceIds: new Map(),
    pendingTerminalReportedInstanceIds: new Set(),
    terminalReportInstanceIdsByEvent: new WeakMap(),
    pendingReports: [],
    suppressedReservationRunnerIds: new Map(),
    canonicalReservationIdsByRunner: new Map(),
  };

  return {
    launch: (launch) => launchRunner(context, launch),
    observe: () => observe(context),
    reconcile: () => reconcile(context),
    tick: () => tick(context),
    terminate: (ids) => terminate(context, ids),
    flush: () => flush(context),
  };
}

async function launchRunner(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
): Promise<void> {
  try {
    await attachProviderIdentity(context, launch);
    await reportEvents(context, [eventForLaunch(context, launch, 'starting')]);
    const instance = await context.engine.runInstance({
      clientToken: launch.providerRunnerId,
      tags: buildInstanceTags({launch, identity: context.identity}),
      ami: launch.template.spec.ami,
      instanceType: launch.template.spec.instanceType,
      market: launch.template.spec.market,
      spotMaxPrice: launch.template.spec.spotMaxPrice,
      subnetId: selectSubnet(launch),
      securityGroupIds: launch.template.spec.securityGroups,
      ...(launch.template.spec.iamInstanceProfile
        ? {iamInstanceProfile: launch.template.spec.iamInstanceProfile}
        : {}),
      associatePublicIp: launch.template.spec.associatePublicIp,
      rootVolumeGb: launch.template.spec.rootVolumeGb,
      rootDeviceName: launch.template.spec.rootDeviceName,
      ...(context.renderUserData ? {userData: context.renderUserData(launch)} : {}),
    });
    context.locallyLaunched.set(launch.providerRunnerId, {
      runnerInstanceId: launch.runnerInstanceId,
      templateKey: launch.template.key,
      launchedAt: new Date(context.now()),
    });
    recordEc2Launch(launch.template.spec.market, 'launched');
    logger().info(
      {
        provisioned_runner_id: launch.providerRunnerId,
        runner_instance_id: launch.runnerInstanceId,
        aws_instance_id: instance.instanceId,
      },
      'Launched EC2 runner instance',
    );
  } catch (error) {
    recordEc2Launch(launch.template.spec.market, launchOutcome(error));
    logger().error(
      {
        err: error,
        provisioned_runner_id: launch.providerRunnerId,
        runner_instance_id: launch.runnerInstanceId,
      },
      'Failed to launch EC2 runner instance',
    );
    await reportEvents(context, [eventForLaunch(context, launch, 'failed', errorReason(error))]);
    throw error;
  }
}

async function observe(context: Ec2LifecycleContext): Promise<void> {
  const instances = await context.engine.listManaged(context.identity.id);
  await applyObservedInstances(context, instances, new Set());
  await reportEvents(context, []);
}

async function reconcile(context: Ec2LifecycleContext): Promise<void> {
  const instances = await context.engine.listManaged(context.identity.id);
  await reapRegistrationDeadlineInstances(context, instances);
  const observedProviderRunnerIds = observedRunnerIds(instances);
  if (observedProviderRunnerIds.length > MAX_RECONCILE_OBSERVED_RUNNERS) {
    logger().error(
      {
        observedCount: observedProviderRunnerIds.length,
        maxObserved: MAX_RECONCILE_OBSERVED_RUNNERS,
      },
      'Skipping backend reconcile because observed EC2 runner count exceeds the API limit',
    );
    context.canonicalReservationIdsByRunner.clear();
    await applyObservedInstances(context, instances, new Set());
    await reportEvents(context, []);
    return;
  }

  const response = await context.client.reconcileRunnerInstances({
    observed_provider_runner_ids: observedProviderRunnerIds,
  });
  syncCanonicalReservationIds(context, response.runners);
  const terminateIntentIds = new Set(
    response.runners
      .filter((runner) => runner.desired_intent === 'terminate')
      .map((runner) => runner.provider_runner_id),
  );
  if (response.terminated_absent_provider_runner_ids.length > 0) {
    recordEc2ReconcileAbsent();
    logger().info(
      {providerRunnerIds: response.terminated_absent_provider_runner_ids},
      'Backend terminated provisioned runners absent from EC2',
    );
  }

  await applyObservedInstances(context, instances, terminateIntentIds);
  await reportEvents(context, []);
  context.lastReconciledAt = new Date(context.now());
}

async function reapRegistrationDeadlineInstances(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
): Promise<void> {
  const instancesToReap = instances.filter(
    (instance) => isPastRegistrationDeadline(instance, context) && canTerminateInstance(instance),
  );
  await terminateInstances(context, instancesToReap, 'registration-deadline');
}

function tick(context: Ec2LifecycleContext): Promise<void> {
  const needsReconcile =
    !context.lastReconciledAt ||
    context.now().getTime() - context.lastReconciledAt.getTime() >= context.reconcileIntervalMs;
  if (needsReconcile) return reconcile(context);
  return observe(context);
}

async function terminate(
  context: Ec2LifecycleContext,
  providerRunnerIds: readonly string[],
): Promise<void> {
  if (providerRunnerIds.length === 0) return;

  const requestedIds = new Set(providerRunnerIds);
  const instances = await context.engine.listManaged(context.identity.id);
  const matchingInstances = instances.filter((instance) =>
    requestedIds.has(parseInstanceIdentity(instance).providerRunnerId),
  );
  await terminateInstances(context, matchingInstances, 'backend-terminate');
}

async function applyObservedInstances(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
  terminateIntentIds: ReadonlySet<string>,
): Promise<void> {
  const trackerRunners: TrackerSeed[] = [];
  const events: RunnerInstanceReportEventDto[] = [];
  const terminalReportInstanceIds = new Map<RunnerInstanceReportEventDto, string>();
  const assignmentCandidates: AssignmentCandidate[] = [];
  const observedIds = new Set<string>();
  const observedInstanceIds = new Set<string>();
  const observedRunnerInstanceIds = new Set<string>();
  const reapInstances: Ec2InstanceView[] = [];
  const terminateIntentInstances: Ec2InstanceView[] = [];
  const observedAt = context.now().getTime();

  for (const instance of instances) {
    const identity = parseInstanceIdentity(instance);
    observedInstanceIds.add(instance.instanceId);
    if (context.terminalReportedInstanceIds.has(instance.instanceId)) {
      context.terminalReportedInstanceIds.set(instance.instanceId, observedAt);
    }
    if (context.terminationActionedInstanceIds.has(instance.instanceId)) {
      context.terminationActionedInstanceIds.set(instance.instanceId, observedAt);
    }
    if (identity.runnerInstanceId) observedRunnerInstanceIds.add(identity.runnerInstanceId);
    if (!identity.providerRunnerId) continue;
    observedIds.add(identity.providerRunnerId);
    context.locallyLaunched.delete(identity.providerRunnerId);

    const hasTerminateIntent = terminateIntentIds.has(identity.providerRunnerId);
    const pastRegistrationDeadline = isPastRegistrationDeadline(instance, context);
    const terminationRequested = hasTerminateIntent || pastRegistrationDeadline;
    const canTerminate = canTerminateInstance(instance);
    const shouldTerminate = terminationRequested && canTerminate;
    if (hasTerminateIntent && canTerminate) {
      terminateIntentInstances.push(instance);
    } else if (pastRegistrationDeadline && canTerminate) {
      reapInstances.push(instance);
    }

    if (shouldTerminate) {
      // terminateInstances reports the provider-initiated reason: backend-terminate or registration-deadline.
      continue;
    }

    const template = identity.templateKey
      ? context.templatesByKey.get(identity.templateKey)
      : undefined;
    const labels = identity.labels.length > 0 ? identity.labels : (template?.labels ?? []);
    if (labels.length === 0) continue;

    const mapped = mapInstanceState(instance);
    const liveState =
      mapped.state === 'starting' || mapped.state === 'running' ? mapped.state : undefined;
    const terminalObservation = mapped.state === 'failed' || mapped.state === 'terminated';
    const alreadyReportedTerminal =
      terminalObservation && hasTerminalReport(context, instance.instanceId);
    if (!alreadyReportedTerminal) {
      if (terminalObservation) {
        const terminationReason =
          mapped.reason === 'spot-interruption' ? 'spot-interruption' : 'observed-terminated';
        recordEc2Termination(terminationReason);
        logger().info(
          {
            provisioned_runner_id: identity.providerRunnerId,
            ...(identity.runnerInstanceId ? {runner_instance_id: identity.runnerInstanceId} : {}),
            aws_instance_id: instance.instanceId,
            reason: terminationReason,
          },
          'Observed EC2 runner instance termination',
        );
      }
      const event = eventForInstance(context, instance, mapped.state, labels, mapped.reason);
      events.push(event);
      if (terminalObservation) terminalReportInstanceIds.set(event, instance.instanceId);
    }
    if (!terminationRequested && liveState && identity.runnerInstanceId) {
      const hasCanonicalAssignment = context.canonicalReservationIdsByRunner.has(
        identity.providerRunnerId,
      );
      const canonicalReservationId = context.canonicalReservationIdsByRunner.get(
        identity.providerRunnerId,
      );
      const reservationId = hasCanonicalAssignment
        ? canonicalReservationId
        : identity.reservationId;
      if (reservationId) {
        assignmentCandidates.push({
          runnerInstanceId: identity.runnerInstanceId,
          reservationId,
          ...(identity.reservationId ? {observedReservationId: identity.reservationId} : {}),
          ...(canonicalReservationId ? {canonicalReservationId} : {}),
        });
      }
    }
    if (!terminationRequested && liveState && identity.templateKey) {
      trackerRunners.push({
        providerRunnerId: identity.providerRunnerId,
        templateKey: identity.templateKey,
        state: liveState,
      });
    }
  }

  pruneTerminalReportedInstances(context, observedInstanceIds, context.now().getTime());
  pruneTerminationActionedInstances(context, observedInstanceIds, context.now().getTime());
  synthesizeAbsentLaunchedRunners(context, observedIds, trackerRunners, events);
  context.tracker.replaceAll(trackerRunners);
  await assignEnrolledReservations(context, assignmentCandidates, observedRunnerInstanceIds);
  await terminateInstances(context, terminateIntentInstances, 'backend-terminate');
  await terminateInstances(context, reapInstances, 'registration-deadline');
  if (events.length > 0) {
    await reportEvents(context, events, terminalReportInstanceIds);
  }
}

async function assignEnrolledReservations(
  context: Ec2LifecycleContext,
  candidates: readonly AssignmentCandidate[],
  observedRunnerInstanceIds: ReadonlySet<string>,
): Promise<void> {
  pruneSuppressedReservationRunners(context, observedRunnerInstanceIds);

  const assignments = new Map<string, AssignmentCandidate[]>();
  for (const candidate of candidates) {
    const {reservationId} = candidate;
    if (context.suppressedReservationRunnerIds.has(reservationId)) continue;
    const assignmentCandidates = assignments.get(reservationId) ?? [];
    assignmentCandidates.push(candidate);
    assignments.set(reservationId, assignmentCandidates);
  }
  for (const [reservationId, assignmentCandidates] of assignments) {
    const runnerInstanceIds = assignmentCandidates.map((candidate) => candidate.runnerInstanceId);
    try {
      await context.client.assignRunnerInstances(reservationId, runnerInstanceIds);
    } catch (error) {
      const status = responseStatus(error);
      const code = status === 409 ? responseCode(error) : undefined;
      const disposition = assignmentFailureDisposition({status, code});
      if (disposition.permanent) {
        const suppressedRunnerInstanceIds =
          context.suppressedReservationRunnerIds.get(reservationId) ?? new Set<string>();
        for (const runnerInstanceId of runnerInstanceIds) {
          suppressedRunnerInstanceIds.add(runnerInstanceId);
        }
        context.suppressedReservationRunnerIds.set(reservationId, suppressedRunnerInstanceIds);
      }
      const observedReservationIds = uniqueReservationIds({
        candidates: assignmentCandidates,
        select: (candidate) => candidate.observedReservationId,
      });
      const canonicalReservationIds = uniqueReservationIds({
        candidates: assignmentCandidates,
        select: (candidate) => candidate.canonicalReservationId,
      });
      const details = {
        reservationId,
        runnerInstanceIds,
        observedReservationIds,
        canonicalReservationIds,
        err: error,
        status,
        ...(code ? {code} : {}),
        retryable: !disposition.permanent,
      };
      if (disposition.level === 'debug') logger().debug(details, disposition.message);
      else logger().warn(details, disposition.message);
    }
  }
}

function uniqueReservationIds(params: {
  candidates: readonly AssignmentCandidate[];
  select: (candidate: AssignmentCandidate) => string | undefined;
}): string[] {
  return [
    ...new Set(
      params.candidates
        .map(params.select)
        .filter((reservationId): reservationId is string => reservationId !== undefined),
    ),
  ];
}

function syncCanonicalReservationIds(
  context: Ec2LifecycleContext,
  runners: ReconcileRunnerInstancesResponseDto['runners'],
): void {
  context.canonicalReservationIdsByRunner.clear();
  for (const runner of runners) {
    // Absence means a legacy response; explicit null means current canonical state is
    // unassigned, so only the former may fall back to the launch tag.
    if (!Object.hasOwn(runner, 'intended_reservation_id') && runner.reservation_id === null)
      continue;
    context.canonicalReservationIdsByRunner.set(
      runner.provider_runner_id,
      runner.reservation_id ?? runner.intended_reservation_id ?? null,
    );
  }
}

function pruneSuppressedReservationRunners(
  context: Ec2LifecycleContext,
  observedRunnerInstanceIds: ReadonlySet<string>,
): void {
  for (const [reservationId, runnerInstanceIds] of context.suppressedReservationRunnerIds) {
    for (const runnerInstanceId of runnerInstanceIds) {
      if (!observedRunnerInstanceIds.has(runnerInstanceId))
        runnerInstanceIds.delete(runnerInstanceId);
    }
    if (runnerInstanceIds.size === 0) context.suppressedReservationRunnerIds.delete(reservationId);
  }
}

function assignmentFailureDisposition(params: {
  status: number | undefined;
  code: string | undefined;
}): {permanent: boolean; level: 'debug' | 'warn'; message: string} {
  if (params.status === 404) {
    return {
      permanent: true,
      level: 'warn',
      message: 'Reservation assignment stopped because reservation was released',
    };
  }
  if (params.status === 409 && params.code === RESERVATION_EXPIRED_ERROR_CODE) {
    return {
      permanent: true,
      level: 'warn',
      message: 'Reservation assignment stopped because reservation expired',
    };
  }
  if (params.status === 409 && params.code === RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE) {
    return {
      permanent: false,
      level: 'debug',
      message: 'Reservation assignment pending; will retry',
    };
  }
  return {
    permanent: false,
    level: 'warn',
    message: 'Reservation assignment rejected; will retry',
  };
}

function pruneTerminalReportedInstances(
  context: Ec2LifecycleContext,
  observedInstanceIds: ReadonlySet<string>,
  nowMs: number,
): void {
  for (const [instanceId, lastObservedAt] of context.terminalReportedInstanceIds) {
    if (
      !observedInstanceIds.has(instanceId) &&
      nowMs - lastObservedAt >= TERMINAL_REPORT_ABSENCE_GRACE_MS
    ) {
      context.terminalReportedInstanceIds.delete(instanceId);
    }
  }
}

function pruneTerminationActionedInstances(
  context: Ec2LifecycleContext,
  observedInstanceIds: ReadonlySet<string>,
  nowMs: number,
): void {
  for (const [instanceId, actionedAt] of context.terminationActionedInstanceIds) {
    if (
      !observedInstanceIds.has(instanceId) &&
      nowMs - actionedAt >= TERMINAL_REPORT_ABSENCE_GRACE_MS
    ) {
      context.terminationActionedInstanceIds.delete(instanceId);
    }
  }
}

function synthesizeAbsentLaunchedRunners(
  context: Ec2LifecycleContext,
  observedIds: ReadonlySet<string>,
  trackerRunners: TrackerSeed[],
  events: RunnerInstanceReportEventDto[],
): void {
  for (const [providerRunnerId, launched] of context.locallyLaunched) {
    if (observedIds.has(providerRunnerId)) continue;
    const launchAgeMs = context.now().getTime() - launched.launchedAt.getTime();
    if (launchAgeMs < context.reconcileIntervalMs) {
      trackerRunners.push({providerRunnerId, templateKey: launched.templateKey, state: 'starting'});
      continue;
    }
    context.locallyLaunched.delete(providerRunnerId);
    const template = context.templatesByKey.get(launched.templateKey);
    if (!template) continue;
    events.push({
      runner_instance_id: launched.runnerInstanceId,
      provider_runner_id: providerRunnerId,
      template_key: template.key,
      labels: [...template.labels],
      state: 'terminated',
      reported_at: context.now().toISOString(),
      provider_kind: context.providerKind,
    });
  }
}

function isPastRegistrationDeadline(
  instance: Ec2InstanceView,
  context: Ec2LifecycleContext,
): boolean {
  return (
    instance.state === 'pending' &&
    instance.launchTime !== undefined &&
    context.now().getTime() - instance.launchTime.getTime() >= context.registrationDeadlineMs
  );
}

async function terminateInstances(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
  reason: Ec2TerminationReason,
): Promise<void> {
  if (instances.length === 0) return;

  const terminableInstances = instances.filter(canTerminateInstance);
  const instancesToTerminate = terminableInstances.filter(
    (instance) => !context.terminationActionedInstanceIds.has(instance.instanceId),
  );
  for (const instance of instancesToTerminate) {
    await context.engine.terminate([instance.instanceId]);
    const actionedAt = context.now().getTime();
    context.terminationActionedInstanceIds.set(instance.instanceId, actionedAt);
    recordEc2Termination(reason);
  }
  const terminalReportInstanceIds = new Map<RunnerInstanceReportEventDto, string>();
  const events = terminableInstances.flatMap((instance) => {
    const identity = parseInstanceIdentity(instance);
    const template = identity.templateKey
      ? context.templatesByKey.get(identity.templateKey)
      : undefined;
    const labels = identity.labels.length > 0 ? identity.labels : (template?.labels ?? []);
    if (!identity.providerRunnerId || labels.length === 0) return [];
    if (hasTerminalReport(context, instance.instanceId)) return [];
    const event = eventForInstance(context, instance, 'terminated', labels, reason);
    terminalReportInstanceIds.set(event, instance.instanceId);
    return [event];
  });
  if (events.length > 0) {
    await reportEvents(context, events, terminalReportInstanceIds);
  }
  for (const instance of instances) {
    const identity = parseInstanceIdentity(instance);
    context.locallyLaunched.delete(identity.providerRunnerId);
    context.tracker.remove(identity.providerRunnerId);
  }
}

function canTerminateInstance(instance: Ec2InstanceView): boolean {
  return instance.state !== 'shutting-down' && instance.state !== 'terminated';
}

function hasTerminalReport(context: Ec2LifecycleContext, instanceId: string): boolean {
  return (
    context.terminalReportedInstanceIds.has(instanceId) ||
    context.pendingTerminalReportedInstanceIds.has(instanceId)
  );
}

function observedRunnerIds(instances: readonly Ec2InstanceView[]): string[] {
  return [
    ...new Set(
      instances.map((instance) => parseInstanceIdentity(instance).providerRunnerId).filter(Boolean),
    ),
  ];
}

async function attachProviderIdentity(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
): Promise<void> {
  const result = await context.client.attachRunnerInstanceProviderId(
    launch.runnerInstanceId,
    launch.providerRunnerId,
  );
  if (!result.attached) {
    throw new Error(
      `Provider identity was not attached for runner instance ${launch.runnerInstanceId}`,
    );
  }
}

async function reportEvents(
  context: Ec2LifecycleContext,
  events: readonly RunnerInstanceReportEventDto[],
  terminalReportInstanceIds: TerminalReportInstanceIds = new Map(),
): Promise<void> {
  // Pending IDs suppress duplicates without marking delivery. The DTO omits the AWS ID, so
  // object identity keeps each retry correlated with the instance that produced it.
  for (const [event, instanceId] of terminalReportInstanceIds) {
    context.terminalReportInstanceIdsByEvent.set(event, instanceId);
    context.pendingTerminalReportedInstanceIds.add(instanceId);
  }
  const reports = [...context.pendingReports.splice(0), ...events];
  for (let index = 0; index < reports.length; index += MAX_REPORT_BATCH) {
    const batch = reports.slice(index, index + MAX_REPORT_BATCH);
    try {
      await context.client.reportRunnerInstances({events: batch});
      rememberDeliveredTerminalReports(context, batch);
    } catch (error) {
      if (error instanceof ProvisionerAuthenticationError) {
        context.pendingReports.push(...reports.slice(index));
        throw error;
      }
      if (responseStatus(error) === 400) {
        forgetTerminalReports(context, batch);
        continue;
      }
      context.pendingReports.push(...reports.slice(index));
      return;
    }
  }
}

function rememberDeliveredTerminalReports(
  context: Ec2LifecycleContext,
  reports: readonly RunnerInstanceReportEventDto[],
): void {
  for (const report of reports) {
    const instanceId = context.terminalReportInstanceIdsByEvent.get(report);
    if (!instanceId) continue;
    context.terminalReportedInstanceIds.set(instanceId, context.now().getTime());
    context.pendingTerminalReportedInstanceIds.delete(instanceId);
    context.terminalReportInstanceIdsByEvent.delete(report);
  }
}

function forgetTerminalReports(
  context: Ec2LifecycleContext,
  reports: readonly RunnerInstanceReportEventDto[],
): void {
  for (const report of reports) {
    const instanceId = context.terminalReportInstanceIdsByEvent.get(report);
    if (!instanceId) continue;
    context.pendingTerminalReportedInstanceIds.delete(instanceId);
    context.terminalReportInstanceIdsByEvent.delete(report);
  }
}

async function flush(context: Ec2LifecycleContext): Promise<void> {
  try {
    await reportEvents(context, []);
  } catch {
    // Shutdown must remain best-effort; the next process will re-observe AWS state.
  }
}

function eventForLaunch(
  context: Ec2LifecycleContext,
  launch: ProviderRunnerLaunch<Ec2TemplateSpec>,
  state: 'starting' | 'failed',
  reason?: string,
): RunnerInstanceReportEventDto {
  return {
    runner_instance_id: launch.runnerInstanceId,
    provider_runner_id: launch.providerRunnerId,
    ...(launch.reservationId ? {reservation_id: launch.reservationId} : {}),
    template_key: launch.template.key,
    labels: [...launch.template.labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: context.now().toISOString(),
    provider_kind: context.providerKind,
  };
}

function eventForInstance(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  state: RunnerInstanceReportEventDto['state'],
  labels: readonly string[],
  reason?: string,
): RunnerInstanceReportEventDto {
  const identity = parseInstanceIdentity(instance);
  return {
    ...(identity.runnerInstanceId ? {runner_instance_id: identity.runnerInstanceId} : {}),
    provider_runner_id: identity.providerRunnerId,
    ...(identity.reservationId ? {reservation_id: identity.reservationId} : {}),
    ...(identity.templateKey ? {template_key: identity.templateKey} : {}),
    labels: [...labels],
    state,
    ...(reason ? {reason: truncateReason(reason)} : {}),
    reported_at: context.now().toISOString(),
    provider_kind: context.providerKind,
  };
}

function mapInstanceState(instance: Ec2InstanceView): {
  state: RunnerInstanceReportEventDto['state'];
  reason?: string;
} {
  switch (instance.state) {
    case 'pending':
      return {state: 'starting'};
    case 'running':
      return {state: 'running'};
    case 'shutting-down':
    case 'stopping':
      return {state: 'stopping'};
    case 'stopped':
    case 'terminated':
      return isSpotInterruption(instance)
        ? {state: 'failed', reason: 'spot-interruption'}
        : {state: 'terminated'};
    default:
      return {state: 'running', reason: `ec2-state-${instance.state}`};
  }
}

function isSpotInterruption(instance: Ec2InstanceView): boolean {
  return SPOT_INTERRUPTION_REASON.test(
    [instance.stateTransitionReason, instance.stateReasonCode, instance.stateReasonMessage]
      .filter((value): value is string => value !== undefined)
      .join(' '),
  );
}

function selectSubnet(launch: ProviderRunnerLaunch<Ec2TemplateSpec>): string {
  const subnets = launch.template.spec.subnets;
  const hash = [...launch.providerRunnerId].reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );
  const subnet = subnets[hash % subnets.length] ?? subnets[0];
  if (!subnet) throw new Error(`Template ${launch.template.key} has no subnets.`);
  return subnet;
}

function errorReason(error: unknown): string {
  if (error instanceof Ec2EngineError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}

function launchOutcome(error: unknown): 'capacity' | 'throttled' | 'error' {
  if (!(error instanceof Ec2EngineError)) return 'error';
  if (error.reason === 'insufficient-capacity' || error.reason === 'spot-price-too-low')
    return 'capacity';
  return error.reason === 'throttled' ? 'throttled' : 'error';
}

function responseStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const response = (error as Error & {response?: {status?: unknown}}).response;
  return typeof response?.status === 'number' ? response.status : undefined;
}

function responseCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const body = (error as HTTPError).data;
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

function truncateReason(reason: string): string {
  return reason.slice(0, MAX_REASON_LENGTH);
}
