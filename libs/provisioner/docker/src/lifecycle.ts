import {
  MAX_RECONCILE_OBSERVED_RUNNERS,
  MAX_TERMINATION_CANDIDATES,
  type ProviderTerminationCandidateDto,
  type ReconcileRunnerInstancesResponseDto,
  type RunnerInstanceReportEventDto,
  type TerminationReasonDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  LaunchOutcome,
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerIdentity,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {buildContainerLabels, parseContainerIdentity} from '#container-identity.js';
import {type DockerContainerView, type DockerEngine, DockerEngineError} from '#docker-engine.js';
import {closeEpisode, type EpisodeState, type EpisodeUpdate, recordEpisode} from '#episodes.js';
import {parseMemoryToBytes} from '#memory.js';
import type {DockerTemplateSpec} from '#templates.js';

const MAX_REPORT_BATCH = 1000;
const MAX_PENDING_REPORTS = 5000;
const MAX_REASON_LENGTH = 500;
const MAX_REGISTRATION_CANDIDATE_IDS_IN_LOG = 20;
const REGISTRATION_CANDIDATE_RETRY_INITIAL_DELAY_MS = 1_000;
const REGISTRATION_CANDIDATE_RETRY_MAX_DELAY_MS = 60_000;
const REGISTRATION_CANDIDATE_SUBMISSION_EPISODE = 'registration-deadline-candidates';
const REGISTRATION_CANDIDATE_WINDOW_LIMIT_EPISODE = 'registration-deadline-candidate-window-limit';
const REGISTRATION_CANDIDATE_LIMIT_EPISODE = 'registration-deadline-candidate-limit';
const EMPTY_TERMINATE_INTENT_IDS = new Set<string>();

class DockerReconciliationLimitError extends Error {
  constructor(observedCount: number) {
    super(
      `Docker reconciliation observed ${observedCount} managed runners, exceeding the API limit of ${MAX_RECONCILE_OBSERVED_RUNNERS}.`,
    );
    this.name = 'DockerReconciliationLimitError';
  }
}

type TerminationRequestSource = 'backend' | 'poll';

type TrackerSeed = {
  providerRunnerId: string;
  templateKey: string;
  state: 'starting' | 'running';
};

export interface DockerLifecycle {
  launch(launch: ProviderRunnerLaunch<DockerTemplateSpec>): Promise<LaunchOutcome>;
  observe(): Promise<void>;
  reconcile(): Promise<void>;
  tick(): Promise<void>;
  terminate(providerRunnerIds: readonly string[]): Promise<void>;
  flush(): Promise<void>;
  setLoggingDriver(loggingDriver: string): void;
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
  failedContainerRetentionMs?: number;
  maxRetainedFailedContainers?: number;
  loggingDriver?: string;
  loggingDriverSource?: 'daemon' | 'provisioner';
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
  readonly backendTerminationRequestedIds: Set<string>;
  readonly pollTerminationRequestedIds: Set<string>;
  readonly episodes: Map<string, EpisodeState>;
  readonly reportedFailedIds: Set<string>;
  readonly reportedFailedContainerIds: Map<string, string>;
  readonly firstObservedFailedAt: Map<string, Date>;
  readonly pendingReports: RunnerInstanceReportEventDto[];
  readonly pendingMissingLabelEpisodes: Array<{
    providerRunnerId: string;
    templateKey?: string;
    update: EpisodeUpdate;
  }>;
  readonly failedContainerRetentionMs: number;
  readonly maxRetainedFailedContainers: number;
  loggingDriver?: string;
  readonly loggingDriverSource: 'daemon' | 'provisioner';
  registrationCandidateCursor: number;
  registrationCandidateFingerprint?: string;
  registrationCandidateRetryAt?: number;
  registrationCandidateRetryDelayMs: number;
  backendReconcileSucceeded: boolean;
  reportDeliveryDelivered: number;
  reportQueueDropped: number;
}

interface ObservationPlan {
  readonly trackerRunners: TrackerSeed[];
  readonly liveEvents: RunnerInstanceReportEventDto[];
  readonly assignmentCandidates: Array<{reservationId: string; runnerInstanceId: string}>;
  readonly terminalActions: TerminalAction[];
}

interface TerminalAction {
  readonly providerRunnerId: string;
  readonly containerId?: string;
  readonly event?: RunnerInstanceReportEventDto;
  readonly remove?: string;
  readonly killAndRemove?: string;
  readonly retained?: boolean;
  readonly reason?: string;
  readonly requestSource?: TerminationRequestSource;
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
    backendTerminationRequestedIds: new Set<string>(),
    pollTerminationRequestedIds: new Set<string>(),
    episodes: new Map<string, EpisodeState>(),
    reportedFailedIds: new Set<string>(),
    reportedFailedContainerIds: new Map<string, string>(),
    firstObservedFailedAt: new Map<string, Date>(),
    pendingReports: [],
    pendingMissingLabelEpisodes: [],
    failedContainerRetentionMs: args.failedContainerRetentionMs ?? 0,
    maxRetainedFailedContainers: args.maxRetainedFailedContainers ?? 0,
    ...(args.loggingDriver ? {loggingDriver: args.loggingDriver} : {}),
    loggingDriverSource: args.loggingDriverSource ?? 'daemon',
    registrationCandidateCursor: 0,
    registrationCandidateRetryDelayMs: REGISTRATION_CANDIDATE_RETRY_INITIAL_DELAY_MS,
    backendReconcileSucceeded: false,
    reportDeliveryDelivered: 0,
    reportQueueDropped: 0,
  };

  return {
    launch: (runner) => launch(context, runner),
    observe: () => observe(context),
    reconcile: () => reconcile(context),
    tick: () => tick(context),
    terminate: (ids) => terminate(context, ids),
    flush: () => flush(context),
    setLoggingDriver: (loggingDriver) => {
      context.loggingDriver = loggingDriver;
    },
  };
}

async function launch(
  context: DockerLifecycleContext,
  runner: ProviderRunnerLaunch<DockerTemplateSpec>,
): Promise<LaunchOutcome> {
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
      beforeStart: async () => {
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
      },
    });
  } catch (error) {
    await reportContainerCreationFailure(context, runner, error);
    throw error;
  }

  const reported = await reportEvents(context, [
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
  return {containerStarted: true, identityAttached: true, reported};
}

async function reportContainerCreationFailure(
  context: DockerLifecycleContext,
  runner: ProviderRunnerLaunch<DockerTemplateSpec>,
  error: unknown,
): Promise<void> {
  try {
    await context.client.attachRunnerInstanceProviderId(
      runner.runnerInstanceId,
      runner.providerRunnerId,
    );
  } catch (attachError) {
    logger().debug?.(
      {
        event: 'runner.container_launch_failed',
        operation: 'attach_runner_instance_provider_id',
        runnerInstanceId: runner.runnerInstanceId,
        reason: truncateReason(errorReason(attachError)),
      },
      'Failed to attach provider identity after runner container creation failed',
    );
  }
  logger().debug?.(
    {
      event: 'runner.container_launch_failed',
      operation: 'create_and_start',
      providerRunnerId: runner.providerRunnerId,
      runnerInstanceId: runner.runnerInstanceId,
      templateKey: runner.template.key,
      image: runner.template.spec.image,
      loggingDriver: context.loggingDriver ?? 'daemon-default',
      reason: truncateReason(errorReason(error)),
    },
    'Runner container launch failed',
  );
  try {
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
  } catch {
    // Report delivery owns retry and degradation logging. Preserve the Docker error
    // as the launch result instead of reclassifying delivery failure as a launch failure.
  }
}

async function observe(context: DockerLifecycleContext): Promise<void> {
  await reportEvents(context, []);
  const listedContainers = await context.engine.listManaged(context.identity.id);
  const registrationDeadlineCandidates = collectRegistrationDeadlineCandidates(
    context,
    listedContainers,
  );
  if (registrationDeadlineCandidates.length > 0) {
    await reconcileListedContainers(
      context,
      listedContainers,
      registrationDeadlineCandidates,
      false,
    );
    return;
  }
  resetRegistrationCandidateState(context);
  await applyObservedContainers(context, listedContainers, EMPTY_TERMINATE_INTENT_IDS);
  await cleanupRetainedFailedContainers(context, listedContainers);
}

async function reconcile(context: DockerLifecycleContext): Promise<void> {
  await reportEvents(context, []);
  const listedContainers = await context.engine.listManaged(context.identity.id);
  await reconcileListedContainers(
    context,
    listedContainers,
    collectRegistrationDeadlineCandidates(context, listedContainers),
    true,
  );
}

async function reconcileListedContainers(
  context: DockerLifecycleContext,
  listedContainers: readonly DockerContainerView[],
  registrationDeadlineCandidates: readonly ProviderTerminationCandidateDto[],
  forceReconcile: boolean,
): Promise<void> {
  const observedProviderRunnerIds = observedRunnerIds(listedContainers);
  if (observedProviderRunnerIds.length > MAX_RECONCILE_OBSERVED_RUNNERS) {
    logSkippedRegistrationDeadlineCandidates(
      context,
      registrationDeadlineCandidates.length,
      observedProviderRunnerIds.length,
    );
    await applyLocalObservationAndCleanup(context, listedContainers);
    throw new DockerReconciliationLimitError(observedProviderRunnerIds.length);
  }

  closeEpisode(context.episodes, REGISTRATION_CANDIDATE_LIMIT_EPISODE, context.now());
  const candidatesToSubmit = selectRegistrationDeadlineCandidateWindow(
    context,
    registrationDeadlineCandidates,
    forceReconcile,
  );
  if (candidatesToSubmit === undefined) {
    await applyLocalObservationAndCleanup(context, listedContainers);
    return;
  }

  let response: ReconcileRunnerInstancesResponseDto;
  try {
    response = await context.client.reconcileRunnerInstances({
      observed_provider_runner_ids: observedProviderRunnerIds,
      ...(candidatesToSubmit.length > 0 ? {termination_candidates: candidatesToSubmit} : {}),
    });
  } catch (error) {
    if (candidatesToSubmit.length > 0) scheduleRegistrationCandidateRetry(context);
    await applyLocalObservationAndCleanup(context, listedContainers);
    throw error;
  }
  if (candidatesToSubmit.length > 0) {
    scheduleRegistrationCandidateRetry(context);
    logSubmittedRegistrationDeadlineCandidates(context, candidatesToSubmit);
  }
  const terminateIntentReasons = new Map<string, TerminationReasonDto | undefined>();
  for (const runner of response.runners) {
    if (runner.desired_intent !== 'terminate') continue;
    terminateIntentReasons.set(runner.provider_runner_id, runner.termination_reason ?? undefined);
  }
  const containersByProviderRunnerId = new Map(
    listedContainers.map((container) => [
      parseContainerIdentity(container).providerRunnerId,
      container,
    ]),
  );
  const terminateIntentIds = new Set(
    [...terminateIntentReasons.keys()].filter((providerRunnerId) => {
      const reason = terminateIntentReasons.get(providerRunnerId);
      const container = containersByProviderRunnerId.get(providerRunnerId);
      return reason !== 'registration-deadline' || container?.state === 'created';
    }),
  );
  context.backendTerminationRequestedIds.clear();
  for (const providerRunnerId of terminateIntentIds) {
    context.backendTerminationRequestedIds.add(providerRunnerId);
  }
  syncTerminationEpisodes(context);

  if (response.terminated_absent_provider_runner_ids.length > 0) {
    logger().info(
      {
        event: 'runner.container_vanished',
        count: response.terminated_absent_provider_runner_ids.length,
        providerRunnerIdSample: boundedSample(response.terminated_absent_provider_runner_ids),
      },
      'Backend terminated provisioned runners absent from Docker',
    );
  }

  await applyObservedContainers(
    context,
    listedContainers,
    terminateIntentIds,
    terminateIntentReasons,
  );
  await cleanupRetainedFailedContainers(
    context,
    listedContainers.filter(
      (container) => !terminateIntentIds.has(parseContainerIdentity(container).providerRunnerId),
    ),
  );
  context.backendReconcileSucceeded = true;
}

async function applyLocalObservationAndCleanup(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
): Promise<void> {
  await applyObservedContainers(context, containers, EMPTY_TERMINATE_INTENT_IDS);
  await cleanupRetainedFailedContainers(context, containers);
}

function collectRegistrationDeadlineCandidates(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
): ProviderTerminationCandidateDto[] {
  const candidates = new Map<string, ProviderTerminationCandidateDto>();
  for (const container of containers) {
    if (!isStaleRegistrationContainer(context, container)) continue;
    const providerRunnerId = parseContainerIdentity(container).providerRunnerId;
    candidates.set(providerRunnerId, {
      provider_runner_id: providerRunnerId,
      reason: 'registration-deadline',
    });
  }

  const orderedCandidates = [...candidates.values()].sort((left, right) =>
    left.provider_runner_id.localeCompare(right.provider_runner_id),
  );
  return orderedCandidates;
}

function isStaleRegistrationContainer(
  context: DockerLifecycleContext,
  container: DockerContainerView,
): boolean {
  return (
    container.state === 'created' &&
    isPastDeadline(container.createdAt, context.now(), context.registrationDeadlineMs)
  );
}

function selectRegistrationDeadlineCandidateWindow(
  context: DockerLifecycleContext,
  orderedCandidates: readonly ProviderTerminationCandidateDto[],
  forceReconcile: boolean,
): ProviderTerminationCandidateDto[] | undefined {
  if (orderedCandidates.length === 0) {
    resetRegistrationCandidateState(context);
    return [];
  }

  const fingerprint = orderedCandidates
    .map((candidate) => candidate.provider_runner_id)
    .join('\u0000');
  if (context.registrationCandidateFingerprint !== fingerprint) {
    context.registrationCandidateFingerprint = fingerprint;
    delete context.registrationCandidateRetryAt;
    context.registrationCandidateRetryDelayMs = REGISTRATION_CANDIDATE_RETRY_INITIAL_DELAY_MS;
    context.registrationCandidateCursor = 0;
  }
  if (
    !forceReconcile &&
    context.registrationCandidateRetryAt !== undefined &&
    context.now().getTime() < context.registrationCandidateRetryAt
  ) {
    return undefined;
  }

  if (orderedCandidates.length <= MAX_TERMINATION_CANDIDATES) {
    context.registrationCandidateCursor = 0;
    closeEpisode(context.episodes, REGISTRATION_CANDIDATE_WINDOW_LIMIT_EPISODE, context.now());
    return [...orderedCandidates];
  }

  const start = context.registrationCandidateCursor % orderedCandidates.length;
  const rotatedCandidates = [
    ...orderedCandidates.slice(start),
    ...orderedCandidates.slice(0, start),
  ];
  const selectedCandidates = rotatedCandidates.slice(0, MAX_TERMINATION_CANDIDATES);
  context.registrationCandidateCursor =
    (start + selectedCandidates.length) % orderedCandidates.length;
  logRegistrationCandidateWindowLimit(context, orderedCandidates, selectedCandidates.length, start);
  return selectedCandidates;
}

function logRegistrationCandidateWindowLimit(
  context: DockerLifecycleContext,
  orderedCandidates: readonly ProviderTerminationCandidateDto[],
  submittedCount: number,
  start: number,
): void {
  const update = recordEpisode(
    context.episodes,
    REGISTRATION_CANDIDATE_WINDOW_LIMIT_EPISODE,
    context.registrationCandidateFingerprint ?? '',
    context.now(),
  );
  if (!shouldLogEpisode(update)) return;
  logger().warn(
    {
      event: 'provisioner.docker.registration_deadline_candidate_limit',
      candidate_count: orderedCandidates.length,
      submitted_count: submittedCount,
      dropped_count: orderedCandidates.length - submittedCount,
      start_index: start,
      next_start_index: context.registrationCandidateCursor,
      attempts: update.state.attempts,
      suppressed: update.state.suppressed,
    },
    'Capped Docker registration-deadline termination candidates at the API limit',
  );
}

function scheduleRegistrationCandidateRetry(context: DockerLifecycleContext): void {
  const delay = context.registrationCandidateRetryDelayMs;
  context.registrationCandidateRetryAt = context.now().getTime() + delay;
  context.registrationCandidateRetryDelayMs = Math.min(
    REGISTRATION_CANDIDATE_RETRY_MAX_DELAY_MS,
    delay * 2,
  );
}

function resetRegistrationCandidateState(context: DockerLifecycleContext): void {
  delete context.registrationCandidateFingerprint;
  delete context.registrationCandidateRetryAt;
  context.registrationCandidateRetryDelayMs = REGISTRATION_CANDIDATE_RETRY_INITIAL_DELAY_MS;
  context.registrationCandidateCursor = 0;
  closeEpisode(context.episodes, REGISTRATION_CANDIDATE_SUBMISSION_EPISODE, context.now());
  closeEpisode(context.episodes, REGISTRATION_CANDIDATE_WINDOW_LIMIT_EPISODE, context.now());
}

function logSubmittedRegistrationDeadlineCandidates(
  context: DockerLifecycleContext,
  candidates: readonly ProviderTerminationCandidateDto[],
): void {
  const update = recordEpisode(
    context.episodes,
    REGISTRATION_CANDIDATE_SUBMISSION_EPISODE,
    context.registrationCandidateFingerprint ?? '',
    context.now(),
  );
  if (!shouldLogEpisode(update)) return;
  logger().info(
    {
      event: 'provisioner.docker.registration_deadline_candidates_submitted',
      requested_count: candidates.length,
      termination_authorization: 'backend-gated',
      provider_runner_ids: candidates
        .slice(0, MAX_REGISTRATION_CANDIDATE_IDS_IN_LOG)
        .map((candidate) => candidate.provider_runner_id),
      ...(update.transition === 'changed' ? {changed: true} : {}),
    },
    'Sent Docker registration-deadline termination candidates for backend authorization',
  );
}

function logSkippedRegistrationDeadlineCandidates(
  context: DockerLifecycleContext,
  candidateCount: number,
  observedCount: number,
): void {
  if (candidateCount === 0) return;
  const update = recordEpisode(
    context.episodes,
    REGISTRATION_CANDIDATE_LIMIT_EPISODE,
    `${candidateCount}:${observedCount}`,
    context.now(),
  );
  if (!shouldLogEpisode(update)) return;
  logger().warn(
    {
      event: 'provisioner.docker.registration_deadline_candidates_skipped',
      candidate_count: candidateCount,
      observed_count: observedCount,
      max_observed: MAX_RECONCILE_OBSERVED_RUNNERS,
      attempts: update.state.attempts,
      suppressed: update.state.suppressed,
    },
    'Skipped Docker registration-deadline candidates because the observed runner set exceeds the API limit',
  );
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
  context.pendingMissingLabelEpisodes.length = 0;
  context.pollTerminationRequestedIds.clear();
  for (const providerRunnerId of providerRunnerIds) {
    context.pollTerminationRequestedIds.add(providerRunnerId);
  }
  syncTerminationEpisodes(context);
  if (providerRunnerIds.length === 0) return;

  const ids = new Set(providerRunnerIds);
  const containers = await context.engine.listManaged(context.identity.id);
  const actions = containers.flatMap((container) => {
    const parsed = parseContainerIdentity(container);
    return ids.has(parsed.providerRunnerId)
      ? [terminalActionFor(context, container, 'backend-terminate', 'poll')]
      : [];
  });

  flushMissingLabelEpisodes(context);
  await applyTerminalActions(context, actions);
}

function buildObservationPlan(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
  terminateIntentIds: ReadonlySet<string>,
  terminateIntentReasons: ReadonlyMap<string, TerminationReasonDto | undefined>,
): ObservationPlan {
  const listedIds = new Set<string>();
  const plan: ObservationPlan = {
    trackerRunners: [],
    liveEvents: [],
    assignmentCandidates: [],
    terminalActions: [],
  };

  for (const container of containers) {
    recordContainerObservation(
      context,
      plan,
      listedIds,
      container,
      terminateIntentIds,
      terminateIntentReasons,
    );
  }
  pruneFailedObservationState(context, containers, listedIds);
  pruneRequestState(context, listedIds);
  synthesizeVanishedContainers(context, plan, listedIds);

  return plan;
}

function recordContainerObservation(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  listedIds: Set<string>,
  container: DockerContainerView,
  terminateIntentIds: ReadonlySet<string>,
  terminateIntentReasons: ReadonlyMap<string, TerminationReasonDto | undefined>,
): void {
  const parsed = parseContainerIdentity(container);
  listedIds.add(parsed.providerRunnerId);
  const staleRegistration = isStaleRegistrationContainer(context, container);
  const staleEpisodeKey = episodeKey('stale-reap', parsed.providerRunnerId);
  if (!staleRegistration) closeEpisode(context.episodes, staleEpisodeKey);
  if (terminateIntentIds.has(parsed.providerRunnerId)) {
    closeEpisode(context.episodes, staleEpisodeKey);
    plan.terminalActions.push(
      terminalActionFor(
        context,
        container,
        terminateIntentReasons.get(parsed.providerRunnerId) ?? 'backend-terminate',
        'backend',
      ),
    );
    return;
  }

  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logMissingLabels(context, parsed.providerRunnerId, parsed.templateKey);
    return;
  }
  logMissingLabelsRecovery(context, parsed.providerRunnerId);
  recordStaleContainer(context, container, parsed, staleRegistration, staleEpisodeKey);
  recordMappedContainer(context, plan, container, parsed, labels);
}

function logMissingLabelsRecovery(context: DockerLifecycleContext, providerRunnerId: string): void {
  const missingLabelsRecovery = closeEpisode(
    context.episodes,
    episodeKey('missing-labels', providerRunnerId),
    context.now(),
  );
  if (missingLabelsRecovery) {
    logger().info(
      {
        event: 'runner.report_resumed',
        providerRunnerId,
        durationMs: missingLabelsRecovery.durationMs,
        attempts: missingLabelsRecovery.attempts,
        suppressed: missingLabelsRecovery.suppressed,
      },
      'Runner report resumed after labels became available',
    );
  }
}

function recordStaleContainer(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  staleRegistration: boolean,
  staleEpisodeKey: string,
): void {
  if (!staleRegistration) return;
  const update = recordEpisode(
    context.episodes,
    staleEpisodeKey,
    `${container.id}:${parsed.templateKey ?? 'unknown'}`,
    context.now(),
  );
  if (shouldLogEpisode(update)) {
    logger().info(
      {
        event: 'runner.container_registration_deadline_observed',
        operation: 'backend_authorization',
        providerRunnerId: parsed.providerRunnerId,
        containerId: container.id,
        containerName: container.name,
        templateKey: parsed.templateKey,
        ageMs: Math.max(0, context.now().getTime() - container.createdAt.getTime()),
        attempts: update.state.attempts,
        suppressed: update.state.suppressed,
        ...(update.transition === 'changed' ? {changed: true} : {}),
      },
      'Stale runner container awaiting backend authorization',
    );
  }
}

function recordMappedContainer(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  labels: readonly string[],
): void {
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
    recordFailedContainer(context, plan, container, parsed, labels, mapped.reason);
    return;
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

function recordFailedContainer(
  context: DockerLifecycleContext,
  plan: ObservationPlan,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  labels: readonly string[],
  reason: string | undefined,
): void {
  const previousContainerId = context.reportedFailedContainerIds.get(parsed.providerRunnerId);
  if (previousContainerId && previousContainerId !== container.id) {
    context.reportedFailedIds.delete(parsed.providerRunnerId);
    context.reportedFailedContainerIds.delete(parsed.providerRunnerId);
  }
  rememberFirstObservedFailure(context, container);
  const shouldReport = !context.reportedFailedIds.has(parsed.providerRunnerId);
  if (shouldReport) {
    context.reportedFailedIds.add(parsed.providerRunnerId);
    context.reportedFailedContainerIds.set(parsed.providerRunnerId, container.id);
    logFailedContainer(context, container, parsed, reason);
  }
  plan.terminalActions.push({
    providerRunnerId: parsed.providerRunnerId,
    ...(shouldReport
      ? {event: eventFor(container, 'failed', labels, context.providerKind, context.now(), reason)}
      : {}),
    ...(shouldRetainFailedContainer(context) ? {retained: true} : {remove: container.name}),
  });
}

function pruneFailedObservationState(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
  listedProviderIds: ReadonlySet<string>,
): void {
  const listedContainerIds = new Set(containers.map((container) => container.id));
  for (const containerId of context.firstObservedFailedAt.keys()) {
    if (!listedContainerIds.has(containerId)) context.firstObservedFailedAt.delete(containerId);
  }
  for (const providerRunnerId of context.reportedFailedIds) {
    const containerId = context.reportedFailedContainerIds.get(providerRunnerId);
    if (
      !listedProviderIds.has(providerRunnerId) ||
      !containerId ||
      !listedContainerIds.has(containerId)
    ) {
      context.reportedFailedIds.delete(providerRunnerId);
      context.reportedFailedContainerIds.delete(providerRunnerId);
    }
  }
  for (const key of context.episodes.keys()) {
    const containerId = episodeTarget(key, 'failed-cleanup');
    if (containerId && !listedContainerIds.has(containerId)) closeEpisode(context.episodes, key);
  }
}

function pruneRequestState(
  context: DockerLifecycleContext,
  listedProviderIds: ReadonlySet<string>,
): void {
  for (const providerRunnerId of context.backendTerminationRequestedIds) {
    if (!listedProviderIds.has(providerRunnerId)) {
      context.backendTerminationRequestedIds.delete(providerRunnerId);
    }
  }
  for (const providerRunnerId of context.pollTerminationRequestedIds) {
    if (!listedProviderIds.has(providerRunnerId)) {
      context.pollTerminationRequestedIds.delete(providerRunnerId);
    }
  }
  for (const key of context.episodes.keys()) {
    const providerRunnerId =
      episodeTarget(key, 'stale-reap') ?? episodeTarget(key, 'missing-labels');
    if (providerRunnerId && !listedProviderIds.has(providerRunnerId)) {
      closeEpisode(context.episodes, key);
    }
  }
  syncTerminationEpisodes(context);
}

function syncTerminationEpisodes(context: DockerLifecycleContext): void {
  const activeIds = new Set([
    ...context.backendTerminationRequestedIds,
    ...context.pollTerminationRequestedIds,
  ]);
  for (const key of context.episodes.keys()) {
    const providerRunnerId = episodeTarget(key, 'termination');
    if (providerRunnerId && !activeIds.has(providerRunnerId)) {
      closeEpisode(context.episodes, key);
    }
  }
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
  context.reportedFailedIds.delete(parsed.providerRunnerId);
  context.reportedFailedContainerIds.delete(parsed.providerRunnerId);
  context.firstObservedFailedAt.delete(container.id);
  if (parsed.templateKey) {
    context.knownTemplateKeys.set(parsed.providerRunnerId, parsed.templateKey);
  }
  plan.liveEvents.push(
    eventFor(container, mapped.state, labels, context.providerKind, context.now(), mapped.reason),
  );
  logger().debug?.(
    {
      event: mapped.state === 'starting' ? 'runner.container_created' : 'runner.container_running',
      providerRunnerId: parsed.providerRunnerId,
      containerId: container.id,
      containerName: container.name,
      templateKey: parsed.templateKey,
      loggingDriver: container.loggingDriver ?? context.loggingDriver ?? 'daemon-default',
    },
    mapped.state === 'starting' ? 'Runner container created' : 'Runner container running',
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
    logger().info(
      {
        event: 'runner.container_vanished',
        providerRunnerId,
        templateKey: template.key,
      },
      'Runner container vanished from Docker',
    );
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
  terminateIntentReasons: ReadonlyMap<string, TerminationReasonDto | undefined> = new Map(),
): Promise<void> {
  context.pendingMissingLabelEpisodes.length = 0;
  const plan = buildObservationPlan(
    context,
    containers,
    terminateIntentIds,
    terminateIntentReasons,
  );
  flushMissingLabelEpisodes(context);
  await applyObservationPlan(context, plan);
}

async function applyTerminalActions(
  context: DockerLifecycleContext,
  actions: readonly TerminalAction[],
): Promise<void> {
  logRequestedTerminalActions(context, actions);
  const currentContainers = await revalidateRegistrationDeadlineTerminations(context, actions);
  const skippedActions = new Set<TerminalAction>();
  const stateTransitionEvents: RunnerInstanceReportEventDto[] = [];
  for (const action of actions) {
    const currentContainer = currentContainers.get(action.containerId ?? '');
    if (!shouldSkipRegistrationDeadlineTermination(action, currentContainer)) continue;

    skippedActions.add(action);
    context.backendTerminationRequestedIds.delete(action.providerRunnerId);
    syncTerminationEpisodes(context);
    const event = recordRevalidatedLiveContainer(context, currentContainer);
    if (event) stateTransitionEvents.push(event);
    logger().info(
      {
        event: 'runner.container_registration_deadline_termination_skipped',
        operation: 'kill_and_remove',
        providerRunnerId: action.providerRunnerId,
        containerId: action.containerId,
        currentState: currentContainer?.state ?? 'absent',
        reason: 'state-changed',
      },
      'Skipped backend registration-deadline termination after the container state changed',
    );
  }
  if (stateTransitionEvents.length > 0) await reportEvents(context, stateTransitionEvents);
  for (const action of actions) {
    if (skippedActions.has(action)) continue;
    await applyTerminalAction(context, action);
  }
}

function logRequestedTerminalActions(
  context: DockerLifecycleContext,
  actions: readonly TerminalAction[],
): void {
  const requestedIds = actions
    .filter((action) => action.requestSource === 'backend' || action.reason === 'backend-terminate')
    .filter((action) => {
      const update = recordEpisode(
        context.episodes,
        episodeKey('termination', action.providerRunnerId),
        'requested',
        context.now(),
      );
      return shouldLogEpisode(update);
    })
    .map((action) => action.providerRunnerId);
  if (requestedIds.length > 0) {
    logger().info(
      {
        event: 'runner.container_termination_requested',
        operation: 'kill_and_remove',
        count: requestedIds.length,
        providerRunnerIdSample: boundedSample(requestedIds),
      },
      'Runner container termination batch requested',
    );
  }
}

async function applyTerminalAction(
  context: DockerLifecycleContext,
  action: TerminalAction,
): Promise<void> {
  const reportBeforeRemove = action.event?.state === 'failed' && action.remove;
  let reportError: unknown;
  if (reportBeforeRemove && action.event) {
    try {
      await reportEvents(context, [action.event]);
    } catch (error) {
      reportError = error;
    }
  }
  if (action.killAndRemove) await context.engine.killAndRemove(action.killAndRemove);
  if (action.remove) await context.engine.remove(action.remove);
  if (reportError) throw reportError;
  if (!reportBeforeRemove && action.event) await reportEvents(context, [action.event]);
  logTerminalAction(action);
  clearTerminalActionState(context, action);
}

function logTerminalAction(action: TerminalAction): void {
  if (action.event?.state === 'stopped') {
    logger().debug?.(
      {event: 'runner.container_stopped', providerRunnerId: action.providerRunnerId},
      'Runner container stopped successfully',
    );
  }
  if (action.remove || action.killAndRemove) {
    logger().debug?.(
      {
        event: 'runner.container_removed',
        providerRunnerId: action.providerRunnerId,
        operation: action.killAndRemove ? 'kill_and_remove' : 'remove',
      },
      'Runner container removed',
    );
  }
}

async function revalidateRegistrationDeadlineTerminations(
  context: DockerLifecycleContext,
  actions: readonly TerminalAction[],
): Promise<ReadonlyMap<string, DockerContainerView>> {
  if (
    !actions.some(
      (action) =>
        action.reason === 'registration-deadline' &&
        action.requestSource === 'backend' &&
        action.containerId,
    )
  )
    return new Map();

  const currentContainers = await context.engine.listManaged(context.identity.id);
  return new Map(currentContainers.map((container) => [container.id, container]));
}

function shouldSkipRegistrationDeadlineTermination(
  action: TerminalAction,
  currentContainer: DockerContainerView | undefined,
): boolean {
  if (action.reason !== 'registration-deadline' || action.requestSource !== 'backend') return false;
  if (!currentContainer) return true;
  return mapContainerState(currentContainer).state === 'running';
}

function recordRevalidatedLiveContainer(
  context: DockerLifecycleContext,
  container: DockerContainerView | undefined,
): RunnerInstanceReportEventDto | undefined {
  if (!container) return undefined;
  const mapped = mapContainerState(container);
  if (mapped.state !== 'starting' && mapped.state !== 'running') return undefined;

  const parsed = parseContainerIdentity(container);
  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logMissingLabels(context, parsed.providerRunnerId, parsed.templateKey);
    return undefined;
  }
  context.knownLiveIds.add(parsed.providerRunnerId);
  context.reportedFailedIds.delete(parsed.providerRunnerId);
  context.reportedFailedContainerIds.delete(parsed.providerRunnerId);
  context.firstObservedFailedAt.delete(container.id);
  if (parsed.templateKey) {
    context.knownTemplateKeys.set(parsed.providerRunnerId, parsed.templateKey);
    context.tracker.recordStarting({
      providerRunnerId: parsed.providerRunnerId,
      templateKey: parsed.templateKey,
    });
    if (mapped.state === 'running') context.tracker.markRunning(parsed.providerRunnerId);
  }
  return eventFor(
    container,
    mapped.state,
    labels,
    context.providerKind,
    context.now(),
    mapped.reason,
  );
}

function clearTerminalActionState(context: DockerLifecycleContext, action: TerminalAction): void {
  if (action.reason === 'registration-deadline') {
    closeEpisode(context.episodes, episodeKey('stale-reap', action.providerRunnerId));
  }
  if (action.requestSource || action.reason === 'backend-terminate') {
    const requestedIds =
      action.requestSource === 'poll'
        ? context.pollTerminationRequestedIds
        : context.backendTerminationRequestedIds;
    requestedIds.delete(action.providerRunnerId);
    syncTerminationEpisodes(context);
  }
  context.knownLiveIds.delete(action.providerRunnerId);
  context.knownTemplateKeys.delete(action.providerRunnerId);
  context.tracker.remove(action.providerRunnerId);
  if (!action.retained) {
    context.reportedFailedIds.delete(action.providerRunnerId);
    context.reportedFailedContainerIds.delete(action.providerRunnerId);
  }
}

async function reportEvents(
  context: DockerLifecycleContext,
  events: readonly RunnerInstanceReportEventDto[],
): Promise<boolean> {
  const queued = context.pendingReports.splice(0);
  const reports = [...queued, ...events];
  if (reports.length === 0) return true;

  const eventStart = queued.length;
  const eventEnd = eventStart + events.length;
  let deliveredEvents = 0;
  let batchStart = 0;
  const batches = chunk(reports, MAX_REPORT_BATCH);
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index] ?? [];
    const batchEnd = batchStart + batch.length;
    const batchEventStart = Math.max(batchStart, eventStart);
    const batchEventEnd = Math.min(batchEnd, eventEnd);
    const batchEventCount = Math.max(0, batchEventEnd - batchEventStart);
    try {
      await context.client.reportRunnerInstances({events: batch});
      context.reportDeliveryDelivered += batch.length;
      deliveredEvents += batchEventCount;
    } catch (error) {
      if (error instanceof ProvisionerAuthenticationError) {
        bufferReports(context, [...batch, ...batches.slice(index + 1).flat()]);
        recordReportDeliveryFailure(context, error);
        throw error;
      }
      if (isPermanentReportError(error)) {
        logger().error(
          {
            event: 'runner_report.invalid_batch_dropped',
            operation: 'report_runner_instances',
            count: batch.length,
          },
          'Dropped invalid runner report batch',
        );
        batchStart = batchEnd;
        continue;
      }
      const unsent = [...batch, ...batches.slice(index + 1).flat()];
      bufferReports(context, unsent);
      recordReportDeliveryFailure(context, error);
      return deliveredEvents === events.length;
    }
    batchStart = batchEnd;
  }
  recordReportDeliveryRecovery(context);
  return deliveredEvents === events.length;
}

async function flush(context: DockerLifecycleContext): Promise<void> {
  try {
    await reportEvents(context, []);
  } catch (error) {
    logger().error(
      {event: 'runner_report.flush_failed', operation: 'flush_reports', reason: errorReason(error)},
      'Failed to flush provisioned runner reports on shutdown',
    );
  }
}

function terminalActionFor(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  reason: string,
  requestSource?: TerminationRequestSource,
): TerminalAction {
  const parsed = parseContainerIdentity(container);
  const labels = labelsFor(context, parsed.templateKey, parsed.labels);
  if (labels.length === 0) {
    logMissingLabels(context, parsed.providerRunnerId, parsed.templateKey);
    return {
      providerRunnerId: parsed.providerRunnerId,
      containerId: container.id,
      killAndRemove: container.name,
      reason,
      ...(requestSource ? {requestSource} : {}),
    };
  }

  return {
    containerId: container.id,
    ...(parsed.runnerInstanceId ? {runner_instance_id: parsed.runnerInstanceId} : {}),
    providerRunnerId: parsed.providerRunnerId,
    event: eventFor(container, 'terminated', labels, context.providerKind, context.now(), reason),
    killAndRemove: container.name,
    reason,
    ...(requestSource ? {requestSource} : {}),
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
    context.reportQueueDropped += dropped;
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

function episodeKey(kind: string, target: string): string {
  return `${kind}:${target}`;
}

function episodeTarget(key: string, kind: string): string | undefined {
  const prefix = `${kind}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

function shouldLogEpisode(update: {transition: string; reminder: boolean}): boolean {
  return update.transition !== 'suppressed' || update.reminder;
}

function logMissingLabels(
  context: DockerLifecycleContext,
  providerRunnerId: string,
  templateKey: string | undefined,
): void {
  const update = recordEpisode(
    context.episodes,
    episodeKey('missing-labels', providerRunnerId),
    templateKey ?? 'unknown-template',
    context.now(),
  );
  if (!shouldLogEpisode(update)) return;
  context.pendingMissingLabelEpisodes.push({
    providerRunnerId,
    ...(templateKey ? {templateKey} : {}),
    update,
  });
}
function flushMissingLabelEpisodes(context: DockerLifecycleContext): void {
  if (context.pendingMissingLabelEpisodes.length === 0) return;
  const episodes = context.pendingMissingLabelEpisodes.splice(0);
  logger().warn(
    {
      event: 'runner.report_skipped',
      count: episodes.length,
      providerRunnerIdSample: boundedSample(episodes.map(({providerRunnerId}) => providerRunnerId)),
      attempts: Math.max(...episodes.map(({update: item}) => item.state.attempts)),
      suppressed: episodes.reduce((sum, {update: item}) => sum + item.state.suppressed, 0),
      ...(episodes.some(({update: item}) => item.transition === 'changed') ? {changed: true} : {}),
    },
    'Skipping provisioned runner reports because labels are unavailable',
  );
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

async function cleanupRetainedFailedContainers(
  context: DockerLifecycleContext,
  containers: readonly DockerContainerView[],
): Promise<DockerContainerView[]> {
  if (!shouldRetainFailedContainer(context)) return [...containers];

  const failed = containers.filter(isFailedContainer);
  const cleanupEligibleFailed = failed.filter((container) => !container.terminalInspectFailed);
  const now = context.now();
  for (const container of failed) rememberFirstObservedFailure(context, container, now);
  const expired = cleanupEligibleFailed.filter(
    (container) => failureAge(context, container, now) >= context.failedContainerRetentionMs,
  );
  const notExpired = failed.filter((container) => !expired.includes(container));
  const limitEvicted = [...notExpired]
    .sort(
      (left, right) => countEvictionAge(context, left, now) - countEvictionAge(context, right, now),
    )
    .slice(context.maxRetainedFailedContainers);
  const removals = dedupeContainers([...expired, ...limitEvicted]);
  const removedIds = new Set<string>();
  let failedRemoval = 0;
  const cleanupEpisodes: Array<{
    container: DockerContainerView;
    error: unknown;
    update: ReturnType<typeof recordEpisode>;
  }> = [];

  for (const container of removals) {
    try {
      await context.engine.remove(container.name);
      removedIds.add(container.id);
      context.firstObservedFailedAt.delete(container.id);
      context.reportedFailedIds.delete(parseContainerIdentity(container).providerRunnerId);
      context.reportedFailedContainerIds.delete(parseContainerIdentity(container).providerRunnerId);
      closeEpisode(context.episodes, episodeKey('failed-cleanup', container.id));
      logger().debug?.(
        {
          event: 'runner.container_removed',
          operation: 'failed_container_cleanup',
          containerId: container.id,
          containerName: container.name,
        },
        'Retained failed runner container removed',
      );
    } catch (error) {
      failedRemoval += 1;
      const update = recordEpisode(
        context.episodes,
        episodeKey('failed-cleanup', container.id),
        errorReason(error),
        now,
      );
      cleanupEpisodes.push({container, error, update});
    }
  }

  const loggableCleanupEpisodes = cleanupEpisodes.filter(({update}) => shouldLogEpisode(update));
  if (loggableCleanupEpisodes.length > 0) {
    const firstFailure = loggableCleanupEpisodes[0];
    if (firstFailure) {
      logger().error(
        {
          event: 'runner.failed_container_cleanup_failed',
          operation: 'remove',
          containerId: firstFailure.container.id,
          containerName: firstFailure.container.name,
          containerIdSample: boundedSample(
            loggableCleanupEpisodes.map(({container}) => container.id),
          ),
          reason: errorReason(firstFailure.error),
          failedRemoval,
          episodeCount: loggableCleanupEpisodes.length,
          attempts: Math.max(...loggableCleanupEpisodes.map(({update}) => update.state.attempts)),
          suppressed: loggableCleanupEpisodes.reduce(
            (sum, {update}) => sum + update.state.suppressed,
            0,
          ),
          ...(loggableCleanupEpisodes.some(({update}) => update.transition === 'changed')
            ? {changed: true}
            : {}),
        },
        'Failed to remove retained failed runner container; will retry',
      );
    }
  }

  const remaining = failed.filter((container) => !removedIds.has(container.id)).length;
  if (removedIds.size > 0) {
    logger().info(
      {
        event: 'runner.cleanup_pass_completed',
        attempted: removals.length,
        removed: removedIds.size,
        failed: failedRemoval,
        expired: expired.length,
        limitEvicted: limitEvicted.length,
        remaining,
      },
      'Failed runner container cleanup pass completed',
    );
  }

  return containers.filter((container) => !removedIds.has(container.id));
}

function shouldRetainFailedContainer(context: DockerLifecycleContext): boolean {
  return context.failedContainerRetentionMs > 0 && context.maxRetainedFailedContainers > 0;
}

function isFailedContainer(container: DockerContainerView): boolean {
  return container.state === 'exited' && (container.oomKilled === true || container.exitCode !== 0);
}

function failureAge(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  now: Date,
): number {
  const terminalAt = failureAtForRetention(context, container, now);
  return Math.max(0, now.getTime() - terminalAt.getTime());
}

function countEvictionAge(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  now: Date,
): number {
  if (!container.finishedAt || Number.isNaN(container.finishedAt.getTime())) {
    return failureAge(context, container, now);
  }
  return failureAge(context, container, now);
}

function rememberFirstObservedFailure(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  observedAt = context.now(),
): void {
  if (container.finishedAt && !Number.isNaN(container.finishedAt.getTime())) return;
  if (context.firstObservedFailedAt.has(container.id)) return;
  context.firstObservedFailedAt.set(container.id, observedAt);
}

function dedupeContainers(containers: readonly DockerContainerView[]): DockerContainerView[] {
  const seen = new Set<string>();
  return containers.filter((container) => {
    if (seen.has(container.id)) return false;
    seen.add(container.id);
    return true;
  });
}

function logFailedContainer(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  parsed: ParsedContainerIdentity,
  reason: string | undefined,
): void {
  const finishedAtUnavailable =
    !container.finishedAt || Number.isNaN(container.finishedAt.getTime());
  if (finishedAtUnavailable) logFailureTimestampFallback(container);
  const runtimeEndAt = failureAtForRetention(context, container, context.now());
  const runtimeMs = containerRuntimeMs(container, runtimeEndAt);
  const retentionDeadline = failedContainerRetentionDeadline(context, container);
  const retained = shouldRetainFailedContainer(context);
  const forensicFields = forensicLogFields(container, context);
  logger().error(
    {
      event: 'runner.container_failed',
      providerRunnerId: parsed.providerRunnerId,
      ...(parsed.runnerInstanceId ? {runnerInstanceId: parsed.runnerInstanceId} : {}),
      containerId: container.id,
      containerName: container.name,
      templateKey: parsed.templateKey,
      image: container.image,
      exitCode: container.exitCode ?? null,
      oomKilled: container.oomKilled ?? false,
      reason,
      runtimeMs,
      loggingDriver: container.loggingDriver ?? context.loggingDriver ?? 'daemon-default',
      loggingDriverSource: context.loggingDriverSource,
      ...(retentionDeadline ? {retentionDeadline: retentionDeadline.toISOString()} : {}),
      ...forensicFields,
    },
    retained
      ? 'Runner container failed and was retained for forensic inspection'
      : 'Runner container failed',
  );
}

function logFailureTimestampFallback(container: DockerContainerView): void {
  logger().debug?.(
    {
      event: 'runner.container_failure_timestamp_fallback',
      operation: 'failed_container_retention',
      containerId: container.id,
      containerName: container.name,
      fallback: 'firstObservedAt',
      reason: container.terminalInspectFailed
        ? 'terminal-inspect-unavailable'
        : 'finished-at-unavailable',
    },
    container.terminalInspectFailed
      ? 'Failure timestamp unavailable; TTL cleanup is deferred but count-bounded cleanup still applies'
      : 'Failure timestamp unavailable; first-observed failure time will drive TTL cleanup',
  );
}

function containerRuntimeMs(
  container: DockerContainerView,
  runtimeEndAt: Date,
): number | undefined {
  if (!container.startedAt || Number.isNaN(container.startedAt.getTime())) return undefined;
  return Math.max(0, runtimeEndAt.getTime() - container.startedAt.getTime());
}

function failedContainerRetentionDeadline(
  context: DockerLifecycleContext,
  container: DockerContainerView,
): Date | undefined {
  if (!shouldRetainFailedContainer(context) || container.terminalInspectFailed) return undefined;
  return new Date(
    failureAtForRetention(context, container, context.now()).getTime() +
      context.failedContainerRetentionMs,
  );
}

function forensicLogFields(
  container: DockerContainerView,
  context: DockerLifecycleContext,
): Record<string, string> {
  const driver = container.loggingDriver ?? context.loggingDriver;
  if (driver === 'local' || driver === 'json-file') {
    return {
      dockerLogsCommand: `docker --host "$SHIPFOX_PROVISIONER_DOCKER_HOST" logs --timestamps --tail 200 ${container.name}`,
      dockerLogsHostHint:
        'Target the daemon configured by SHIPFOX_PROVISIONER_DOCKER_HOST; omit --host when using the local default',
    };
  }
  if (driver === 'journald') {
    return {
      journaldCommand: `journalctl CONTAINER_NAME=${container.name}`,
      journaldHostHint:
        'Run journalctl on the Docker daemon host configured by SHIPFOX_PROVISIONER_DOCKER_HOST',
    };
  }
  if (driver === 'none') {
    return {loggingBackendHint: 'Container logging is disabled for this driver'};
  }
  return {
    loggingBackendHint: driver
      ? `Use the ${driver} Docker logging backend to retrieve container output`
      : 'Use the configured Docker logging backend to retrieve container output',
  };
}

function failureAtForRetention(
  context: DockerLifecycleContext,
  container: DockerContainerView,
  fallback: Date,
): Date {
  if (container.finishedAt && !Number.isNaN(container.finishedAt.getTime())) {
    return container.finishedAt;
  }
  return context.firstObservedFailedAt.get(container.id) ?? fallback;
}

function recordReportDeliveryFailure(context: DockerLifecycleContext, error: unknown): void {
  const hadEpisode = context.episodes.has('report-delivery');
  const update = recordEpisode(
    context.episodes,
    'report-delivery',
    errorReason(error),
    context.now(),
  );
  if (!hadEpisode) {
    context.reportDeliveryDelivered = 0;
  }
  if (update.transition !== 'suppressed') {
    logger().error(
      {
        event: 'runner_report.delivery_degraded',
        operation: 'report_runner_instances',
        cause: errorReason(error),
        pending: context.pendingReports.length,
        attempts: update.state.attempts,
        suppressed: update.state.suppressed,
        ...(context.reportQueueDropped > 0 ? {queueDropped: context.reportQueueDropped} : {}),
      },
      'Runner report delivery degraded',
    );
  }
  if (update.reminder) {
    logger().warn(
      {
        event: 'runner_report.delivery_degraded_reminder',
        pending: context.pendingReports.length,
        suppressed: update.state.suppressed,
        attempts: update.state.attempts,
        ...(context.reportQueueDropped > 0 ? {queueDropped: context.reportQueueDropped} : {}),
      },
      'Runner report delivery remains degraded',
    );
  }
}

function recordReportDeliveryRecovery(context: DockerLifecycleContext): void {
  const episode = context.episodes.get('report-delivery');
  if (!episode) return;
  logger().info(
    {
      event: 'runner_report.delivery_recovered',
      outageDurationMs: Math.max(0, context.now().getTime() - episode.startedAt.getTime()),
      attempts: episode.attempts,
      delivered: context.reportDeliveryDelivered,
      suppressed: episode.suppressed,
      ...(context.reportQueueDropped > 0 ? {queueDropped: context.reportQueueDropped} : {}),
    },
    'Runner report delivery recovered',
  );
  closeEpisode(context.episodes, 'report-delivery');
  context.reportDeliveryDelivered = 0;
  context.reportQueueDropped = 0;
}

function boundedSample(values: readonly string[], limit = 20): string[] {
  return values.slice(0, limit);
}
