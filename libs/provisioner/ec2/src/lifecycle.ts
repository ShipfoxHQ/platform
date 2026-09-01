import {
  MAX_RECONCILE_OBSERVED_RUNNERS,
  MAX_TERMINATION_CANDIDATES,
  type ProviderTerminationCandidateDto,
  RESERVATION_EXPIRED_ERROR_CODE,
  type ReconcileRunnerInstancesResponseDto,
  RUNNER_INSTANCE_NOT_ASSIGNABLE_ERROR_CODE,
  type RunnerInstanceReportEventDto,
  type TerminationReasonDto,
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
import {
  type Ec2Engine,
  Ec2EngineError,
  type Ec2InstanceView,
  type Ec2StatusCheckStatus,
} from '#ec2-engine.js';
import {buildInstanceTags, parseInstanceIdentity} from '#instance-identity.js';
import {
  type Ec2HealthCheckType,
  type Ec2TerminationReason,
  recordEc2ForcedTerminationRetry,
  recordEc2HealthImpaired,
  recordEc2Launch,
  recordEc2PendingDuration,
  recordEc2ReconcileAbsent,
  recordEc2StoppingRetryExhausted,
  recordEc2StoppingTimestampMissing,
  recordEc2Termination,
} from '#metrics/instance.js';
import {type Ec2TemplateSpec, UNKNOWN_TEMPLATE_KEY} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_REASON_LENGTH = 500;
// DescribeInstances can retain terminated instances for about an hour. Keep the marker
// for that long across a listing gap to cover eventual-consistency blips.
const TERMINAL_REPORT_ABSENCE_GRACE_MS = 60 * 60 * 1000;
const SPOT_INTERRUPTION_REASON =
  /spot|instance-terminated-by-price|instance-terminated-no-capacity/i;
const MAX_SCHEDULED_EVENT_CODES_IN_LOG = 20;
const MAX_TERMINATION_CANDIDATE_IDS_IN_LOG = 20;

type Ec2HealthObservation = {
  checkType: Ec2HealthCheckType;
  status: Ec2StatusCheckStatus;
  impairedSince?: Date;
};

type TrackerSeed = {
  providerRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

type LocallyLaunchedRunner = {
  runnerInstanceId: string;
  templateKey: string;
  ami: string;
  launchedAt: Date;
};

type HealthImpairmentObservation = {
  lastObservedAt: number;
  consecutiveObservations: number;
};

type AssignmentCandidate = {
  reservationId: string;
  runnerInstanceId: string;
  observedReservationId?: string;
  canonicalReservationId?: string;
};

type TerminalReportInstanceIds = ReadonlyMap<RunnerInstanceReportEventDto, string>;

type TerminationIntent = {
  reason?: TerminationReasonDto;
  stoppingAt?: Date;
  retryAllowed: boolean;
};

type TerminationAction = {
  actionedAt: number;
  force: boolean;
  authorizationReason?: TerminationReasonDto;
  stoppingAt?: Date;
  stoppingTimestampMissingReported?: boolean;
  stoppingRetryExhaustedReported?: boolean;
};

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
  readonly stoppingTimeoutMs: number;
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
  readonly stoppingTimeoutMs: number;
  readonly now: () => Date;
  readonly renderUserData?: (launch: ProviderRunnerLaunch<Ec2TemplateSpec>) => string;
  // Newly launched runners that have not appeared in an EC2 listing yet. These entries
  // retain the existing absence-synthesis grace behavior.
  readonly locallyLaunched: Map<string, LocallyLaunchedRunner>;
  // Launch timestamps retained after a first pending observation until running or terminal.
  readonly pendingLaunches: Map<string, LocallyLaunchedRunner>;
  readonly terminalReportedInstanceIds: Map<string, number>;
  // Keep successful actions across short listing gaps so eventual-consistency reads do not
  // repeat AWS calls or metrics. A stopping-timeout authorization gets one bounded forced
  // retry after its first observed stopping deadline.
  readonly terminationActionedInstanceIds: Map<string, TerminationAction>;
  readonly pendingTerminalReportedInstanceIds: Set<string>;
  readonly terminalReportInstanceIdsByEvent: WeakMap<RunnerInstanceReportEventDto, string>;
  readonly pendingReports: RunnerInstanceReportEventDto[];
  readonly suppressedReservationRunnerIds: Map<string, Set<string>>;
  readonly canonicalReservationIdsByRunner: Map<string, string | null>;
  readonly healthImpairmentObservations: Map<string, HealthImpairmentObservation>;
  terminationCandidateCursor: number;
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
    stoppingTimeoutMs: options.stoppingTimeoutMs,
    now: options.now ?? (() => new Date()),
    ...(options.renderUserData ? {renderUserData: options.renderUserData} : {}),
    locallyLaunched: new Map(),
    pendingLaunches: new Map(),
    terminalReportedInstanceIds: new Map(),
    terminationActionedInstanceIds: new Map(),
    pendingTerminalReportedInstanceIds: new Set(),
    terminalReportInstanceIdsByEvent: new WeakMap(),
    pendingReports: [],
    suppressedReservationRunnerIds: new Map(),
    canonicalReservationIdsByRunner: new Map(),
    healthImpairmentObservations: new Map(),
    terminationCandidateCursor: 0,
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
      associatePublicIp: launch.template.spec.associatePublicIp,
      rootVolumeGb: launch.template.spec.rootVolumeGb,
      rootDeviceName: launch.template.spec.rootDeviceName,
      workspaceVolumeGb: launch.template.spec.workspaceVolumeGb,
      workspaceDeviceName: launch.template.spec.workspaceDeviceName,
      ...(context.renderUserData ? {userData: context.renderUserData(launch)} : {}),
    });
    const locallyLaunched = {
      runnerInstanceId: launch.runnerInstanceId,
      templateKey: launch.template.key,
      ami: launch.template.spec.ami,
      launchedAt: new Date(context.now()),
    };
    context.locallyLaunched.set(launch.providerRunnerId, locallyLaunched);
    context.pendingLaunches.set(launch.providerRunnerId, locallyLaunched);
    recordEc2Launch(launch.template.spec.market, 'launched', launch.template.key);
    logger().info(
      {
        provisioned_runner_id: launch.providerRunnerId,
        runner_instance_id: launch.runnerInstanceId,
        aws_instance_id: instance.instanceId,
      },
      'Launched EC2 runner instance',
    );
  } catch (error) {
    recordEc2Launch(launch.template.spec.market, launchOutcome(error), launch.template.key);
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
  await applyObservedInstances(context, instances, new Map());
  await reportEvents(context, []);
}

async function reconcile(context: Ec2LifecycleContext): Promise<void> {
  const instances = await context.engine.listManaged(context.identity.id, {includeStatus: true});
  const registrationDeadlineCandidates = observeRegistrationDeadlineCandidates(context, instances);
  const healthCandidates = observeEc2Health(context, instances);
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
    await applyObservedInstances(context, instances, new Map());
    await reportEvents(context, []);
    return;
  }

  const terminationCandidates = selectTerminationCandidateWindow(context, [
    ...registrationDeadlineCandidates,
    ...healthCandidates,
  ]);
  const response = await context.client.reconcileRunnerInstances({
    observed_provider_runner_ids: observedProviderRunnerIds,
    ...(terminationCandidates.length > 0 ? {termination_candidates: terminationCandidates} : {}),
  });
  const submittedHealthCandidates = terminationCandidates.filter(
    (candidate) => candidate.reason === 'provider-health-failed',
  );
  if (submittedHealthCandidates.length > 0) {
    logger().info(
      {
        event: 'provisioner.ec2.provider_health_candidates_submitted',
        requested_count: submittedHealthCandidates.length,
        termination_authorization: 'backend-gated',
        provider_runner_ids: submittedHealthCandidates
          .slice(0, MAX_TERMINATION_CANDIDATE_IDS_IN_LOG)
          .map((candidate) => candidate.provider_runner_id),
      },
      'Sent EC2 provider health termination candidates for backend authorization',
    );
  }
  const submittedRegistrationDeadlineCandidates = terminationCandidates.filter(
    (candidate) => candidate.reason === 'registration-deadline',
  );
  if (submittedRegistrationDeadlineCandidates.length > 0) {
    logger().info(
      {
        event: 'provisioner.ec2.registration_deadline_candidates_submitted',
        requested_count: submittedRegistrationDeadlineCandidates.length,
        termination_authorization: 'backend-gated',
        provider_runner_ids: submittedRegistrationDeadlineCandidates
          .slice(0, MAX_TERMINATION_CANDIDATE_IDS_IN_LOG)
          .map((candidate) => candidate.provider_runner_id),
      },
      'Sent EC2 registration deadline candidates for backend authorization',
    );
  }
  syncCanonicalReservationIds(context, response.runners);
  const terminateIntents = new Map<string, TerminationIntent>();
  for (const runner of response.runners) {
    if (runner.desired_intent !== 'terminate') continue;
    terminateIntents.set(runner.provider_runner_id, {
      ...(runner.termination_reason ? {reason: runner.termination_reason} : {}),
      ...(runner.stopping_at ? {stoppingAt: new Date(runner.stopping_at)} : {}),
      retryAllowed:
        runner.bound_job === null || runner.bound_job.cancellation_requested_at !== null,
    });
  }
  if (response.terminated_absent_provider_runner_ids.length > 0) {
    recordEc2ReconcileAbsent(response.terminated_absent_provider_runner_ids.length);
    logger().info(
      {providerRunnerIds: response.terminated_absent_provider_runner_ids},
      'Backend terminated provisioned runners absent from EC2',
    );
  }

  await applyObservedInstances(context, instances, terminateIntents);
  await reportEvents(context, []);
  context.lastReconciledAt = new Date(context.now());
}

function observeEc2Health(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
): ProviderTerminationCandidateDto[] {
  const candidates = new Map<string, ProviderTerminationCandidateDto>();
  const observedInstanceIds = new Set(instances.map((instance) => instance.instanceId));
  for (const instanceId of context.healthImpairmentObservations.keys()) {
    if (!observedInstanceIds.has(instanceId))
      context.healthImpairmentObservations.delete(instanceId);
  }

  for (const instance of instances) {
    const candidate = observeEc2InstanceHealth(context, instance);
    if (candidate) candidates.set(candidate.provider_runner_id, candidate);
  }

  const orderedCandidates = [...candidates.values()].sort((left, right) =>
    left.provider_runner_id.localeCompare(right.provider_runner_id),
  );
  return orderedCandidates;
}

function observeEc2InstanceHealth(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
): ProviderTerminationCandidateDto | undefined {
  const observations = healthObservations(instance);
  const impaired = observations.filter((observation) => observation.status === 'impaired');
  for (const observation of impaired) recordEc2HealthImpaired(observation.checkType);

  const identity = parseInstanceIdentity(instance);
  const consecutiveObservations = updateHealthImpairmentObservation(context, instance, impaired);
  if (!hasHealthSignal(instance, observations)) return undefined;

  const candidateDecision = healthCandidateDecision(
    context,
    instance,
    identity.providerRunnerId,
    impaired,
    consecutiveObservations,
  );
  logEc2HealthObservation(context, instance, identity, observations, candidateDecision);
  if (candidateDecision !== 'eligible' || !identity.providerRunnerId) return undefined;
  return {
    provider_runner_id: identity.providerRunnerId,
    reason: 'provider-health-failed',
  };
}

function hasHealthSignal(
  instance: Ec2InstanceView,
  observations: readonly Ec2HealthObservation[],
): boolean {
  if ((instance.scheduledEvents?.length ?? 0) > 0) return true;
  return observations.some(
    (observation) =>
      observation.status === 'impaired' ||
      observation.status === 'initializing' ||
      observation.status === 'insufficient-data',
  );
}

function healthCandidateDecision(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  providerRunnerId: string | undefined,
  impaired: readonly Ec2HealthObservation[],
  consecutiveObservations: number,
):
  | 'observe-only'
  | 'awaiting-persistence'
  | 'not-running'
  | 'missing-provider-runner-id'
  | 'eligible' {
  if (impaired.length === 0) return 'observe-only';
  if (instance.state !== 'running') return 'not-running';
  if (!providerRunnerId) return 'missing-provider-runner-id';
  if (!hasPersistentImpairment(context, impaired, consecutiveObservations))
    return 'awaiting-persistence';
  return 'eligible';
}

function logEc2HealthObservation(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  observations: readonly Ec2HealthObservation[],
  candidateDecision: ReturnType<typeof healthCandidateDecision>,
): void {
  const fields = {
    event: 'provisioner.ec2.provider_health_observed',
    ...(identity.providerRunnerId ? {provisioned_runner_id: identity.providerRunnerId} : {}),
    ...(identity.runnerInstanceId ? {runner_instance_id: identity.runnerInstanceId} : {}),
    aws_instance_id: instance.instanceId,
    template_key: resolveTemplateKey(context, [identity.templateKey]),
    ec2_state: instance.state,
    health_checks: observations.map((observation) => ({
      check_type: observation.checkType,
      status: observation.status,
      ...(observation.impairedSince
        ? {impaired_since: observation.impairedSince.toISOString()}
        : {}),
    })),
    scheduled_event_codes: (instance.scheduledEvents ?? [])
      .slice(0, MAX_SCHEDULED_EVENT_CODES_IN_LOG)
      .map((event) => event.code),
    health_candidate_decision: candidateDecision,
    health_candidate_collection: 'reconcile',
  };
  if (
    candidateDecision === 'eligible' ||
    candidateDecision === 'not-running' ||
    candidateDecision === 'missing-provider-runner-id'
  )
    logger().warn(fields, 'Observed impaired EC2 runner health');
  else logger().debug(fields, 'Observed transient EC2 runner health status');
}

function updateHealthImpairmentObservation(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  impaired: readonly Ec2HealthObservation[],
): number {
  if (instance.state !== 'running') {
    context.healthImpairmentObservations.delete(instance.instanceId);
    return 0;
  }

  const previous = context.healthImpairmentObservations.get(instance.instanceId);
  if (!hasEc2HealthCheckData(instance)) return previous?.consecutiveObservations ?? 0;
  if (impaired.length === 0) {
    context.healthImpairmentObservations.delete(instance.instanceId);
    return 0;
  }

  const observedAt = context.now().getTime();
  const observationWindowMs = Math.max(context.reconcileIntervalMs * 2, 1);
  const isConsecutive =
    previous !== undefined &&
    observedAt >= previous.lastObservedAt &&
    observedAt - previous.lastObservedAt <= observationWindowMs;
  const consecutiveObservations = isConsecutive
    ? Math.min(previous.consecutiveObservations + 1, 2)
    : 1;
  context.healthImpairmentObservations.set(instance.instanceId, {
    lastObservedAt: observedAt,
    consecutiveObservations,
  });
  return consecutiveObservations;
}

function hasEc2HealthCheckData(instance: Ec2InstanceView): boolean {
  return (
    instance.systemStatus !== undefined ||
    instance.instanceStatus !== undefined ||
    instance.attachedEbsStatus !== undefined
  );
}

function hasPersistentImpairment(
  context: Ec2LifecycleContext,
  impaired: readonly Ec2HealthObservation[],
  consecutiveObservations: number,
): boolean {
  if (consecutiveObservations >= 2) return true;

  const now = context.now().getTime();
  const graceMs = Math.max(context.reconcileIntervalMs, 0);
  return impaired.some((observation) => {
    const impairedSince = observation.impairedSince?.getTime();
    return (
      impairedSince !== undefined &&
      Number.isFinite(impairedSince) &&
      now >= impairedSince + graceMs
    );
  });
}

function observeRegistrationDeadlineCandidates(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
): ProviderTerminationCandidateDto[] {
  const candidates = new Map<string, ProviderTerminationCandidateDto>();
  for (const instance of instances) {
    if (!isPastRegistrationDeadline(instance, context) || !canTerminateInstance(instance)) continue;
    const providerRunnerId = parseInstanceIdentity(instance).providerRunnerId;
    if (!providerRunnerId) continue;
    candidates.set(providerRunnerId, {
      provider_runner_id: providerRunnerId,
      reason: 'registration-deadline',
    });
  }
  return [...candidates.values()].sort((left, right) =>
    left.provider_runner_id.localeCompare(right.provider_runner_id),
  );
}

function selectTerminationCandidateWindow(
  context: Ec2LifecycleContext,
  orderedCandidates: readonly ProviderTerminationCandidateDto[],
): ProviderTerminationCandidateDto[] {
  const deduplicatedCandidates = deduplicateTerminationCandidates(orderedCandidates).sort(
    (left, right) => left.provider_runner_id.localeCompare(right.provider_runner_id),
  );
  if (deduplicatedCandidates.length <= MAX_TERMINATION_CANDIDATES) {
    context.terminationCandidateCursor = 0;
    return deduplicatedCandidates;
  }

  const start = context.terminationCandidateCursor % deduplicatedCandidates.length;
  const rotatedCandidates = [
    ...deduplicatedCandidates.slice(start),
    ...deduplicatedCandidates.slice(0, start),
  ];
  const selectedCandidates = rotatedCandidates.slice(0, MAX_TERMINATION_CANDIDATES);
  context.terminationCandidateCursor =
    (start + selectedCandidates.length) % deduplicatedCandidates.length;
  const allHealthCandidates = deduplicatedCandidates.every(
    (candidate) => candidate.reason === 'provider-health-failed',
  );
  logger().warn(
    {
      event: allHealthCandidates
        ? 'provisioner.ec2.provider_health_candidate_limit'
        : 'provisioner.ec2.termination_candidate_limit',
      candidate_count: deduplicatedCandidates.length,
      submitted_count: selectedCandidates.length,
      dropped_count: deduplicatedCandidates.length - selectedCandidates.length,
      start_index: start,
      next_start_index: context.terminationCandidateCursor,
    },
    allHealthCandidates
      ? 'Capped EC2 provider health termination candidates at the API limit'
      : 'Capped EC2 termination candidates at the API limit',
  );
  return selectedCandidates;
}

function deduplicateTerminationCandidates(
  candidates: readonly ProviderTerminationCandidateDto[],
): ProviderTerminationCandidateDto[] {
  return [
    ...new Map(candidates.map((candidate) => [candidate.provider_runner_id, candidate])).values(),
  ];
}

function healthObservations(instance: Ec2InstanceView): Ec2HealthObservation[] {
  return [
    {
      checkType: 'system',
      status: instance.systemStatus?.status ?? 'unknown',
      ...(instance.systemStatus?.impairedSince
        ? {impairedSince: instance.systemStatus.impairedSince}
        : {}),
    },
    {
      checkType: 'instance',
      status: instance.instanceStatus?.status ?? 'unknown',
      ...(instance.instanceStatus?.impairedSince
        ? {impairedSince: instance.instanceStatus.impairedSince}
        : {}),
    },
    {
      checkType: 'attached-ebs',
      status: instance.attachedEbsStatus?.status ?? 'unknown',
      ...(instance.attachedEbsStatus?.impairedSince
        ? {impairedSince: instance.attachedEbsStatus.impairedSince}
        : {}),
    },
  ];
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
  terminateIntents: ReadonlyMap<string, TerminationIntent>,
): Promise<void> {
  const plan = createEc2ObservationPlan();
  const observedAt = context.now().getTime();
  for (const instance of instances)
    recordObservedInstance(context, plan, instance, terminateIntents, observedAt);
  pruneTerminalReportedInstances(context, plan.observedInstanceIds, context.now().getTime());
  pruneTerminationActionedInstances(context, plan.observedInstanceIds, context.now().getTime());
  synthesizeAbsentLaunchedRunners(context, plan.observedIds, plan.trackerRunners, plan.events);
  context.tracker.replaceAll(plan.trackerRunners);
  await assignEnrolledReservations(
    context,
    plan.assignmentCandidates,
    plan.observedRunnerInstanceIds,
  );
  await terminateInstances(
    context,
    plan.terminateIntentInstances,
    'backend-terminate',
    plan.forcedTerminateIntentIds,
    plan.terminationAuthorizationReasons,
    plan.terminationDeadlines,
    plan.missingStoppingTimestampIntentIds,
  );
  if (plan.events.length > 0)
    await reportEvents(context, plan.events, plan.terminalReportInstanceIds);
}

interface Ec2ObservationPlan {
  trackerRunners: TrackerSeed[];
  events: RunnerInstanceReportEventDto[];
  terminalReportInstanceIds: Map<RunnerInstanceReportEventDto, string>;
  assignmentCandidates: AssignmentCandidate[];
  observedIds: Set<string>;
  observedInstanceIds: Set<string>;
  observedRunnerInstanceIds: Set<string>;
  terminateIntentInstances: Ec2InstanceView[];
  forcedTerminateIntentIds: Set<string>;
  terminationAuthorizationReasons: Map<string, TerminationReasonDto | undefined>;
  terminationDeadlines: Map<string, Date>;
  missingStoppingTimestampIntentIds: Set<string>;
}

function createEc2ObservationPlan(): Ec2ObservationPlan {
  return {
    trackerRunners: [],
    events: [],
    terminalReportInstanceIds: new Map(),
    assignmentCandidates: [],
    observedIds: new Set(),
    observedInstanceIds: new Set(),
    observedRunnerInstanceIds: new Set(),
    terminateIntentInstances: [],
    forcedTerminateIntentIds: new Set(),
    terminationAuthorizationReasons: new Map(),
    terminationDeadlines: new Map(),
    missingStoppingTimestampIntentIds: new Set(),
  };
}

function recordObservedInstance(
  context: Ec2LifecycleContext,
  plan: Ec2ObservationPlan,
  instance: Ec2InstanceView,
  terminateIntents: ReadonlyMap<string, TerminationIntent>,
  observedAt: number,
): void {
  const identity = parseInstanceIdentity(instance);
  recordObservedIdentity(context, plan, instance, identity.runnerInstanceId, observedAt);
  if (!identity.providerRunnerId) return;
  plan.observedIds.add(identity.providerRunnerId);
  const pendingLaunch = context.pendingLaunches.get(identity.providerRunnerId);
  context.locallyLaunched.delete(identity.providerRunnerId);
  recordPendingLaunchObservation(context, instance, identity, pendingLaunch);
  recordExhaustedStoppingRetry(
    context,
    instance,
    identity,
    terminateIntents.get(identity.providerRunnerId),
  );
  const termination = recordTerminationCandidate(
    context,
    plan,
    instance,
    identity.providerRunnerId,
    terminateIntents,
  );
  if (termination.skipObservation) return;

  const template = identity.templateKey
    ? context.templatesByKey.get(identity.templateKey)
    : undefined;
  const labels = identity.labels.length > 0 ? identity.labels : (template?.labels ?? []);
  if (labels.length === 0) return;
  const mapped = mapInstanceState(instance);
  recordObservedInstanceEvent(context, plan, instance, identity, pendingLaunch, labels, mapped);
  recordObservedAssignment(context, plan, identity, mapped.state, termination.requested);
  if (
    !termination.requested &&
    (mapped.state === 'starting' || mapped.state === 'running') &&
    identity.templateKey
  ) {
    plan.trackerRunners.push({
      providerRunnerId: identity.providerRunnerId,
      templateKey: identity.templateKey,
      state: mapped.state,
    });
  }
}

function recordObservedIdentity(
  context: Ec2LifecycleContext,
  plan: Ec2ObservationPlan,
  instance: Ec2InstanceView,
  runnerInstanceId: string | undefined,
  observedAt: number,
): void {
  plan.observedInstanceIds.add(instance.instanceId);
  if (context.terminalReportedInstanceIds.has(instance.instanceId)) {
    context.terminalReportedInstanceIds.set(instance.instanceId, observedAt);
  }
  const terminationAction = context.terminationActionedInstanceIds.get(instance.instanceId);
  if (terminationAction) {
    context.terminationActionedInstanceIds.set(instance.instanceId, {
      ...terminationAction,
      actionedAt: observedAt,
    });
  }
  if (runnerInstanceId) plan.observedRunnerInstanceIds.add(runnerInstanceId);
}

function recordPendingLaunchObservation(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  pendingLaunch: LocallyLaunchedRunner | undefined,
): void {
  if (!pendingLaunch) return;
  if (instance.state !== 'running') {
    if (isTerminalPendingState(instance.state))
      context.pendingLaunches.delete(identity.providerRunnerId);
    return;
  }
  const templateKey = resolveTemplateKey(context, [
    identity.templateKey,
    pendingLaunch.templateKey,
  ]);
  const template = context.templatesByKey.get(templateKey);
  context.pendingLaunches.delete(identity.providerRunnerId);
  if (!template) return;
  recordEc2PendingDuration({
    durationMs: context.now().getTime() - pendingLaunch.launchedAt.getTime(),
    templateKey,
    market: template.spec.market,
    architecture: instance.architecture ?? 'unknown',
    availabilityZone: instance.availabilityZone ?? 'unknown',
  });
}

function shouldRetryTermination(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  intent: TerminationIntent | undefined,
): boolean {
  if (instance.state !== 'stopping' || !intent?.retryAllowed || !intent.reason) return false;
  if (!intent.stoppingAt) return false;
  const action = context.terminationActionedInstanceIds.get(instance.instanceId);
  // A prior graceful action without a reason cannot prove that this retry belongs
  // to the same authorization. A changed reason with an existing authorization
  // remains eligible because the API can reclassify the intent while stopping.
  if (action && (action.force || action.authorizationReason === undefined)) return false;
  return context.now().getTime() - intent.stoppingAt.getTime() >= context.stoppingTimeoutMs;
}

function recordExhaustedStoppingRetry(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  intent: TerminationIntent | undefined,
): void {
  if (instance.state !== 'stopping') return;
  const action = context.terminationActionedInstanceIds.get(instance.instanceId);
  if (!action?.force || action.stoppingRetryExhaustedReported) return;

  const templateKey = resolveTemplateKey(context, [identity.templateKey]);
  const template = context.templatesByKey.get(templateKey);
  const stoppingAt = action.stoppingAt ?? intent?.stoppingAt;
  recordEc2StoppingRetryExhausted(templateKey);
  logger().warn(
    terminationLogFields(
      instance,
      identity,
      templateKey,
      template,
      'backend-terminate',
      undefined,
      {
        force: true,
        ...(stoppingAt
          ? {
              stoppingAt,
              stoppingTimeoutDeadline: new Date(stoppingAt.getTime() + context.stoppingTimeoutMs),
            }
          : {}),
      },
    ),
    'EC2 runner instance remains in stopping after forced termination retry',
  );
  context.terminationActionedInstanceIds.set(instance.instanceId, {
    ...action,
    stoppingRetryExhaustedReported: true,
  });
}

function hasMissingStoppingTimestampBeenReported(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
): boolean {
  return (
    context.terminationActionedInstanceIds.get(instance.instanceId)
      ?.stoppingTimestampMissingReported ?? false
  );
}

function reportMissingStoppingTimestamp(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
): void {
  if (hasMissingStoppingTimestampBeenReported(context, instance)) return;
  const identity = parseInstanceIdentity(instance);
  const templateKey = resolveTemplateKey(context, [identity.templateKey]);
  const template = context.templatesByKey.get(templateKey);
  recordEc2StoppingTimestampMissing(templateKey);
  logger().warn(
    terminationLogFields(
      instance,
      identity,
      templateKey,
      template,
      'backend-terminate',
      undefined,
      {
        force: false,
        stoppingAt: null,
        stoppingTimeoutDeadline: null,
      },
    ),
    'EC2 runner instance is stopping without a backend stopping timestamp; using graceful termination',
  );
  const action = context.terminationActionedInstanceIds.get(instance.instanceId);
  if (action)
    context.terminationActionedInstanceIds.set(instance.instanceId, {
      ...action,
      stoppingTimestampMissingReported: true,
    });
}

function recordTerminationCandidate(
  context: Ec2LifecycleContext,
  plan: Ec2ObservationPlan,
  instance: Ec2InstanceView,
  providerRunnerId: string,
  terminateIntents: ReadonlyMap<string, TerminationIntent>,
): {requested: boolean; skipObservation: boolean} {
  const terminationIntent = terminateIntents.get(providerRunnerId);
  const registrationDeadlineReached = isPastRegistrationDeadline(instance, context);
  const retry = shouldRetryTermination(context, instance, terminationIntent);
  const stoppingTimestampMissing = isStoppingTimestampMissing(instance, terminationIntent);
  const terminationRequested = shouldRequestTermination(
    instance,
    terminationIntent,
    retry,
    stoppingTimestampMissing,
  );
  const requested = terminationRequested;
  if (!canTerminateInstance(instance)) return {requested, skipObservation: false};
  if (!terminationIntent) return {requested, skipObservation: registrationDeadlineReached};
  if (stoppingTimestampMissing) reportMissingStoppingTimestamp(context, instance);
  if (terminationRequested) {
    plan.terminateIntentInstances.push(instance);
    if (retry) plan.forcedTerminateIntentIds.add(instance.instanceId);
    plan.terminationAuthorizationReasons.set(instance.instanceId, terminationIntent.reason);
    if (retry && terminationIntent.stoppingAt)
      plan.terminationDeadlines.set(
        instance.instanceId,
        new Date(terminationIntent.stoppingAt.getTime() + context.stoppingTimeoutMs),
      );
    if (stoppingTimestampMissing) plan.missingStoppingTimestampIntentIds.add(instance.instanceId);
  }
  return {requested, skipObservation: requested};
}

function isStoppingTimestampMissing(
  instance: Ec2InstanceView,
  intent: TerminationIntent | undefined,
): boolean {
  return (
    instance.state === 'stopping' &&
    intent !== undefined &&
    intent.retryAllowed &&
    intent.stoppingAt === undefined
  );
}

function shouldRequestTermination(
  instance: Ec2InstanceView,
  intent: TerminationIntent | undefined,
  retry: boolean,
  stoppingTimestampMissing: boolean,
): boolean {
  if (!intent) return false;
  if (instance.state !== 'stopping') return true;
  return retry || stoppingTimestampMissing;
}

function recordObservedInstanceEvent(
  context: Ec2LifecycleContext,
  plan: Ec2ObservationPlan,
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  pendingLaunch: LocallyLaunchedRunner | undefined,
  labels: readonly string[],
  mapped: ReturnType<typeof mapInstanceState>,
): void {
  const terminal = mapped.state === 'failed' || mapped.state === 'terminated';
  if (terminal && hasTerminalReport(context, instance.instanceId)) return;
  if (terminal) logObservedTermination(context, instance, identity, pendingLaunch, mapped.reason);
  const event = eventForInstance(context, instance, mapped.state, labels, mapped.reason);
  plan.events.push(event);
  if (terminal) plan.terminalReportInstanceIds.set(event, instance.instanceId);
}

function logObservedTermination(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  pendingLaunch: LocallyLaunchedRunner | undefined,
  reason: string | undefined,
): void {
  const terminationReason =
    reason === 'spot-interruption' ? 'spot-interruption' : 'observed-terminated';
  const templateKey = resolveTemplateKey(context, [
    identity.templateKey,
    pendingLaunch?.templateKey,
  ]);
  const template = context.templatesByKey.get(templateKey);
  recordEc2Termination(terminationReason, templateKey);
  logger().info(
    terminationLogFields(instance, identity, templateKey, template, terminationReason),
    'Observed EC2 runner instance termination',
  );
}

function recordObservedAssignment(
  context: Ec2LifecycleContext,
  plan: Ec2ObservationPlan,
  identity: ReturnType<typeof parseInstanceIdentity>,
  state: ReturnType<typeof mapInstanceState>['state'],
  terminationRequested: boolean,
): void {
  if (
    terminationRequested ||
    (state !== 'starting' && state !== 'running') ||
    !identity.runnerInstanceId
  )
    return;
  const hasCanonical = context.canonicalReservationIdsByRunner.has(identity.providerRunnerId);
  const canonicalReservationId = context.canonicalReservationIdsByRunner.get(
    identity.providerRunnerId,
  );
  const reservationId = hasCanonical ? canonicalReservationId : identity.reservationId;
  if (!reservationId) return;
  plan.assignmentCandidates.push({
    runnerInstanceId: identity.runnerInstanceId,
    reservationId,
    ...(identity.reservationId ? {observedReservationId: identity.reservationId} : {}),
    ...(canonicalReservationId ? {canonicalReservationId} : {}),
  });
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
    await assignReservationGroup(context, reservationId, assignmentCandidates);
  }
}

async function assignReservationGroup(
  context: Ec2LifecycleContext,
  reservationId: string,
  assignmentCandidates: readonly AssignmentCandidate[],
): Promise<void> {
  const runnerInstanceIds = assignmentCandidates.map((candidate) => candidate.runnerInstanceId);
  try {
    await context.client.assignRunnerInstances(reservationId, runnerInstanceIds);
  } catch (error) {
    const status = responseStatus(error);
    const code = status === 409 ? responseCode(error) : undefined;
    const disposition = assignmentFailureDisposition({status, code});
    if (disposition.permanent) {
      suppressReservationRunners(context, reservationId, runnerInstanceIds);
    }
    const details = {
      reservationId,
      runnerInstanceIds,
      observedReservationIds: uniqueReservationIds({
        candidates: assignmentCandidates,
        select: (candidate) => candidate.observedReservationId,
      }),
      canonicalReservationIds: uniqueReservationIds({
        candidates: assignmentCandidates,
        select: (candidate) => candidate.canonicalReservationId,
      }),
      err: error,
      status,
      ...(code ? {code} : {}),
      retryable: !disposition.permanent,
    };
    if (disposition.level === 'debug') logger().debug(details, disposition.message);
    else logger().warn(details, disposition.message);
  }
}

function suppressReservationRunners(
  context: Ec2LifecycleContext,
  reservationId: string,
  runnerInstanceIds: readonly string[],
): void {
  const suppressed = context.suppressedReservationRunnerIds.get(reservationId) ?? new Set<string>();
  for (const runnerInstanceId of runnerInstanceIds) suppressed.add(runnerInstanceId);
  context.suppressedReservationRunnerIds.set(reservationId, suppressed);
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
      nowMs - actionedAt.actionedAt >= TERMINAL_REPORT_ABSENCE_GRACE_MS
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
    context.pendingLaunches.delete(providerRunnerId);
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
  forceInstanceIds: ReadonlySet<string> = new Set(),
  authorizationReasons: ReadonlyMap<string, TerminationReasonDto | undefined> = new Map(),
  stoppingDeadlines: ReadonlyMap<string, Date> = new Map(),
  missingStoppingTimestampIntentIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  if (instances.length === 0) return;

  const terminableInstances = instances.filter(canTerminateInstance);
  const instancesToTerminate = terminableInstances.filter((instance) =>
    shouldIssueTermination(context, instance, forceInstanceIds, authorizationReasons),
  );
  for (const instance of instancesToTerminate)
    await terminateInstance(
      context,
      instance,
      reason,
      forceInstanceIds,
      authorizationReasons,
      stoppingDeadlines,
      missingStoppingTimestampIntentIds,
    );

  const terminalReportInstanceIds = new Map<RunnerInstanceReportEventDto, string>();
  const events = terminationEvents(
    context,
    terminableInstances,
    reason,
    terminalReportInstanceIds,
    authorizationReasons,
  );
  if (events.length > 0) await reportEvents(context, events, terminalReportInstanceIds);
  clearTerminatedInstances(context, instances);
}

function shouldIssueTermination(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  forceInstanceIds: ReadonlySet<string>,
  authorizationReasons: ReadonlyMap<string, TerminationReasonDto | undefined>,
): boolean {
  const force = forceInstanceIds.has(instance.instanceId);
  const action = context.terminationActionedInstanceIds.get(instance.instanceId);
  if (!action) return true;
  if (!force || action.force) return false;
  return action.authorizationReason !== undefined && authorizationReasons.has(instance.instanceId);
}

async function terminateInstance(
  context: Ec2LifecycleContext,
  instance: Ec2InstanceView,
  reason: Ec2TerminationReason,
  forceInstanceIds: ReadonlySet<string>,
  authorizationReasons: ReadonlyMap<string, TerminationReasonDto | undefined>,
  stoppingDeadlines: ReadonlyMap<string, Date>,
  missingStoppingTimestampIntentIds: ReadonlySet<string>,
): Promise<void> {
  const force = forceInstanceIds.has(instance.instanceId);
  const identity = parseInstanceIdentity(instance);
  const locallyLaunched = identity.providerRunnerId
    ? (context.pendingLaunches.get(identity.providerRunnerId) ??
      context.locallyLaunched.get(identity.providerRunnerId))
    : undefined;
  const templateKey = resolveTemplateKey(context, [
    identity.templateKey,
    locallyLaunched?.templateKey,
  ]);
  const template = context.templatesByKey.get(templateKey);
  if (force) recordEc2ForcedTerminationRetry(templateKey);
  await context.engine.terminate([instance.instanceId], force ? {force: true} : undefined);
  const stoppingDeadline = stoppingDeadlines.get(instance.instanceId);
  const stoppingAt = stoppingDeadline
    ? new Date(stoppingDeadline.getTime() - context.stoppingTimeoutMs)
    : undefined;
  const authorizationReason = authorizationReasons.get(instance.instanceId);
  const effectiveReason = authorizationReason ?? reason;
  context.terminationActionedInstanceIds.set(instance.instanceId, {
    actionedAt: context.now().getTime(),
    force,
    ...(authorizationReason ? {authorizationReason} : {}),
    ...(stoppingAt ? {stoppingAt} : {}),
    ...(missingStoppingTimestampIntentIds.has(instance.instanceId)
      ? {stoppingTimestampMissingReported: true}
      : {}),
  });
  recordEc2Termination(effectiveReason, templateKey);
  const terminationLogOptions = force
    ? {
        force: true,
        stoppingAt: stoppingAt ?? null,
        stoppingTimeoutDeadline: stoppingDeadline ?? null,
      }
    : undefined;
  logger().info(
    terminationLogFields(
      instance,
      identity,
      templateKey,
      template,
      effectiveReason,
      locallyLaunched?.ami,
      terminationLogOptions,
    ),
    'Terminated EC2 runner instance',
  );
}

function terminationEvents(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
  reason: Ec2TerminationReason,
  terminalReportInstanceIds: Map<RunnerInstanceReportEventDto, string>,
  authorizationReasons: ReadonlyMap<string, TerminationReasonDto | undefined>,
): RunnerInstanceReportEventDto[] {
  return instances.flatMap((instance) => {
    const identity = parseInstanceIdentity(instance);
    const template = identity.templateKey
      ? context.templatesByKey.get(identity.templateKey)
      : undefined;
    const labels = identity.labels.length > 0 ? identity.labels : (template?.labels ?? []);
    if (!identity.providerRunnerId || labels.length === 0) return [];
    if (hasTerminalReport(context, instance.instanceId)) return [];
    const event = eventForInstance(
      context,
      instance,
      'terminated',
      labels,
      authorizationReasons.get(instance.instanceId) ?? reason,
    );
    terminalReportInstanceIds.set(event, instance.instanceId);
    return [event];
  });
}

function clearTerminatedInstances(
  context: Ec2LifecycleContext,
  instances: readonly Ec2InstanceView[],
): void {
  for (const instance of instances) {
    const identity = parseInstanceIdentity(instance);
    context.locallyLaunched.delete(identity.providerRunnerId);
    context.pendingLaunches.delete(identity.providerRunnerId);
    context.tracker.remove(identity.providerRunnerId);
  }
}

function isTerminalPendingState(state: Ec2InstanceView['state']): boolean {
  return (
    state === 'shutting-down' ||
    state === 'stopping' ||
    state === 'stopped' ||
    state === 'terminated'
  );
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

function resolveTemplateKey(
  context: Ec2LifecycleContext,
  candidates: readonly (string | undefined)[],
): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && context.templatesByKey.has(candidate)) return candidate;
  }
  return UNKNOWN_TEMPLATE_KEY;
}

function terminationLogFields(
  instance: Ec2InstanceView,
  identity: ReturnType<typeof parseInstanceIdentity>,
  templateKey: string,
  template: ProvisionerTemplate<Ec2TemplateSpec> | undefined,
  reason: string,
  fallbackAmi?: string,
  options?: {
    force: boolean;
    stoppingAt?: Date | null;
    stoppingTimeoutDeadline?: Date | null;
  },
) {
  return {
    ...(identity.providerRunnerId ? {provisioned_runner_id: identity.providerRunnerId} : {}),
    ...(identity.runnerInstanceId ? {runner_instance_id: identity.runnerInstanceId} : {}),
    instance_id: instance.instanceId,
    aws_instance_id: instance.instanceId,
    template_key: templateKey,
    ami: instance.ami ?? fallbackAmi ?? template?.spec.ami ?? 'unknown',
    launch_time: instance.launchTime?.toISOString() ?? null,
    reason,
    ...(options
      ? {
          force: options.force,
          stopping_at: options.stoppingAt?.toISOString() ?? null,
          stopping_timeout_deadline: options.stoppingTimeoutDeadline?.toISOString() ?? null,
        }
      : {}),
    ...(instance.stateTransitionReason !== undefined
      ? {state_transition_reason: instance.stateTransitionReason}
      : {}),
    ...(instance.stateReasonCode !== undefined
      ? {state_reason_code: instance.stateReasonCode}
      : {}),
    ...(instance.stateReasonMessage !== undefined
      ? {state_reason_message: instance.stateReasonMessage}
      : {}),
    ...(instance.availabilityZone !== undefined
      ? {availability_zone: instance.availabilityZone}
      : {}),
    ...healthTerminationLogFields(instance),
  };
}

function healthTerminationLogFields(instance: Ec2InstanceView): Record<string, string | string[]> {
  return {
    ...healthStatusLogFields('system', instance.systemStatus),
    ...healthStatusLogFields('instance', instance.instanceStatus),
    ...healthStatusLogFields('attached_ebs', instance.attachedEbsStatus),
    ...scheduledEventLogFields(instance.scheduledEvents),
  };
}

function healthStatusLogFields(
  name: 'system' | 'instance' | 'attached_ebs',
  status: Ec2InstanceView['systemStatus'] | undefined,
): Record<string, string> {
  if (!status) return {};
  return {
    [`${name}_status`]: status.status,
    ...(status.impairedSince
      ? {[`${name}_status_impaired_since`]: status.impairedSince.toISOString()}
      : {}),
  };
}

function scheduledEventLogFields(
  events: Ec2InstanceView['scheduledEvents'],
): Record<string, string[]> {
  if (!events || events.length === 0) return {};
  return {
    scheduled_event_codes: events
      .slice(0, MAX_SCHEDULED_EVENT_CODES_IN_LOG)
      .map((event) => event.code),
  };
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
