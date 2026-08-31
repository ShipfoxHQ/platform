import type {
  ProviderTerminationCandidateReasonDto,
  RunnerJobStopReasonDto,
} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  RunnerInstance,
  RunnerInstanceState,
  RunnerTerminationReason,
} from '#core/entities/runner-instance.js';
import {
  attachRunnerInstanceProviderId as attachRunnerInstanceProviderIdDb,
  isTerminalState,
  listActiveRunnerInstances,
  listActiveRunningJobExecutions,
  listProvisionerTerminationAuthorizations,
  type RunnerInstanceReportEvent,
  reconcileRunnerInstances as reconcileRunnerInstancesDb,
  reportRunnerInstances as reportRunnerInstancesDb,
} from '#db/index.js';
import type {
  ActiveRunningJobExecution,
  RunnerInstanceBoundJobExecution,
} from '#db/job-executions.js';
import {
  providerRunnerAbsentTerminatedCount,
  providerRunnerReconcileCallCount,
  providerRunnerReportCount,
  providerRunnerTerminateIntentHonoredCount,
  providerRunnerTerminateIntentIssuedCount,
  recordRunnerJobCleanupGraceAge,
  recordRunnerReservationReleased,
  runnerTerminationAuthorizationHonoredCount,
} from '#metrics/instance.js';
import {config} from '../config.js';
import {
  authorizeRunnerTermination,
  recordRunnerTerminationAuthorizationTelemetry,
  resolveRunnerTerminationReason,
} from './termination-authorization.js';

export interface ReportRunnerInstancesParams {
  scope: 'installation' | 'workspace';
  workspaceId: string | null;
  provisionerId: string;
  events: RunnerInstanceReportEvent[];
}

export function attachRunnerInstanceProviderId(params: {
  runnerInstanceId: string;
  provisionerId: string;
  providerRunnerId: string;
}): Promise<boolean> {
  return attachRunnerInstanceProviderIdDb(params);
}

export interface ReportRunnerInstancesResult {
  accepted: number;
  reservationsReleased: number;
}

export interface ProviderTerminationCandidate {
  providerRunnerId: string;
  reason: ProviderTerminationCandidateReasonDto;
}

export interface ReconcileRunnerInstancesParams {
  workspaceId: string | null;
  provisionerId: string;
  observedRunnerInstanceIds: string[];
  terminationCandidates?: ProviderTerminationCandidate[];
}

export type ReconcileDesiredIntent = 'keep' | 'terminate';
type ReconcileDesiredIntentReason = RunnerTerminationReason;

export interface ReconciledBoundJobExecution {
  jobId: string;
  jobExecutionId: string;
  workflowRunAttemptId: string;
  lastHeartbeatAt: Date;
  cancellationRequestedAt: Date | null;
  cancellationReason: RunnerJobStopReasonDto | null;
}

type JobStopExecution = Pick<
  ReconciledBoundJobExecution,
  'cancellationRequestedAt' | 'cancellationReason'
>;

export interface ReconciledRunnerInstance {
  providerRunnerId: string;
  state: RunnerInstanceState | null;
  intendedReservationId: string | null;
  reservationId: string | null;
  runnerSessionId: string | null;
  stoppingAt: Date | null;
  boundJobExecution: ReconciledBoundJobExecution | null;
  desiredIntent: ReconcileDesiredIntent;
  desiredIntentReason: ReconcileDesiredIntentReason | null;
  /** The durable authorization reason when one has been issued. */
  terminationReason: RunnerTerminationReason | null;
}

export interface ReconcileRunnerInstancesResult {
  runners: ReconciledRunnerInstance[];
  terminatedAbsentRunnerInstanceIds: string[];
}

export type ActiveRunnerState = 'starting' | 'running' | 'stopping' | 'busy';

export interface ActiveRunner {
  runnerSessionId: string | null;
  providerRunnerId: string | null;
  provisionerId: string | null;
  state: ActiveRunnerState;
  labels: string[];
  templateKey: string | null;
  providerKind: string | null;
  jobId: string | null;
  workflowRunAttemptId: string | null;
  projectId: string | null;
  reportedAt: Date | null;
  lastHeartbeatAt: Date | null;
}

export async function reportRunnerInstances(
  params: ReportRunnerInstancesParams,
): Promise<ReportRunnerInstancesResult> {
  const result = await reportRunnerInstancesDb(params);

  for (const event of params.events) {
    providerRunnerReportCount.add(1, {state: event.state});
  }
  const providerKindByRunnerId = params.events.reduce((kinds, event) => {
    if (!kinds.has(event.providerRunnerId) || event.providerKind !== null)
      kinds.set(event.providerRunnerId, event.providerKind);
    return kinds;
  }, new Map<string, string | null>());
  const honoredIntents = new Map(
    result.terminateIntentsHonored.map((intent) => [intent.providerRunnerId, intent]),
  );
  for (const intent of honoredIntents.values()) {
    providerRunnerTerminateIntentHonoredCount.add(1, {reason: intent.reason});
    if (intent.origin === 'durable') {
      runnerTerminationAuthorizationHonoredCount.add(1, {reason: intent.reason});
      logger().info(
        {
          event: 'runner.termination_authorization_honored',
          component: 'provisioner',
          provisionerId: params.provisionerId,
          providerRunnerId: intent.providerRunnerId,
          providerKind: providerKindByRunnerId.get(intent.providerRunnerId),
          reason: intent.reason,
        },
        'Runner termination authorization honored',
      );
    }
  }
  recordRunnerReservationReleased({count: result.reservationsReleased, surface: 'terminal-report'});

  return {
    accepted: result.accepted,
    reservationsReleased: result.reservationsReleased,
  };
}

export async function reconcileRunnerInstances(
  params: ReconcileRunnerInstancesParams,
): Promise<ReconcileRunnerInstancesResult> {
  const terminationCandidates = (params.terminationCandidates ?? []).filter((candidate) => {
    const resolution = params.workspaceId
      ? resolveRunnerTerminationReason({
          provisionerId: params.provisionerId,
          providerRunnerId: candidate.providerRunnerId,
          reason: candidate.reason,
        })
      : {reason: null, rejectionReason: 'unknown-runner' as const};
    if (!resolution.reason)
      recordRunnerTerminationAuthorizationTelemetry(
        {
          provisionerId: params.provisionerId,
          providerRunnerId: candidate.providerRunnerId,
          reason: candidate.reason,
        },
        {outcome: 'rejected', reason: resolution.rejectionReason},
      );
    return Boolean(resolution.reason);
  });
  const observedRunnerInstanceIds = [
    ...new Set([
      ...params.observedRunnerInstanceIds,
      ...(params.terminationCandidates ?? []).map((candidate) => candidate.providerRunnerId),
    ]),
  ];
  const result = await reconcileRunnerInstancesDb({
    ...params,
    terminationCandidates,
    observedRunnerInstanceIds,
    terminateGraceSeconds: config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS,
    postJobExitGraceSeconds: config.RUNNER_POST_JOB_EXIT_GRACE_SECONDS,
    terminationReasonResolver: ({provisionerId, providerRunnerId, reason}) =>
      resolveRunnerTerminationReason({provisionerId, providerRunnerId, reason}),
  });

  for (const {
    providerRunnerId,
    reason,
    telemetry,
    revocationCounts,
  } of result.terminationAuthorizationTelemetry)
    recordRunnerTerminationAuthorizationTelemetry(
      {
        provisionerId: params.provisionerId,
        providerRunnerId,
        reason,
      },
      telemetry,
      revocationCounts,
    );
  recordRunnerReservationReleased({count: result.reservationsReleased, surface: 'reconcile'});
  providerRunnerReconcileCallCount.add(1);
  if (result.absentIds.length > 0) providerRunnerAbsentTerminatedCount.add(result.absentIds.length);

  const now = new Date();
  const reconciledRunners = reconcileRunnerInstancesFromDbResult({
    observedRunnerInstanceIds,
    observedRows: result.observedRows,
    boundJobExecutionsByRunnerInstanceId: result.boundJobExecutionsByRunnerInstanceId,
    cleanupGraceSeconds: config.RUNNER_JOB_CLEANUP_GRACE_SECONDS,
    now,
  });
  for (const runner of reconciledRunners) {
    const cancellationRequestedAt = runner.boundJobExecution?.cancellationRequestedAt;
    const cleanupGraceReason = terminationReasonForJobStop(runner.boundJobExecution ?? undefined);
    if (
      cleanupGraceReason &&
      cancellationRequestedAt &&
      now.getTime() <
        cancellationRequestedAt.getTime() + config.RUNNER_JOB_CLEANUP_GRACE_SECONDS * 1000
    ) {
      recordRunnerJobCleanupGraceAge({
        ageMilliseconds: Math.max(0, now.getTime() - cancellationRequestedAt.getTime()),
        reason: cleanupGraceReason,
      });
    }
  }
  const observedRowByRunnerId = new Map(
    result.observedRows.map((row) => [row.providerRunnerId, row]),
  );
  const candidateAuthorizations = await Promise.all(
    reconciledRunners.flatMap((runner) => {
      const observedRow = observedRowByRunnerId.get(runner.providerRunnerId);
      if (!runner.desiredIntentReason || observedRow?.terminationAuthorizedAt) return [];
      return [
        authorizeRunnerTermination({
          provisionerId: params.provisionerId,
          providerRunnerId: runner.providerRunnerId,
          reason: runner.desiredIntentReason,
        }).then((authorization) => [runner.providerRunnerId, authorization] as const),
      ];
    }),
  );
  const authorizationByCandidateRunnerId = new Map(candidateAuthorizations);
  const authorizations = await listProvisionerTerminationAuthorizations({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    providerRunnerIds: observedRunnerInstanceIds,
    limit: observedRunnerInstanceIds.length,
  });
  const authorizationByRunnerId = new Map(
    authorizations.map((authorization) => [authorization.providerRunnerId, authorization.reason]),
  );
  const newlyAuthorizedRunnerIds = new Set(
    candidateAuthorizations.flatMap(([providerRunnerId, authorization]) =>
      authorization.desiredIntent === 'terminate' ? [providerRunnerId] : [],
    ),
  );
  const runners = reconciledRunners.map((runner) => {
    const candidateAuthorization = authorizationByCandidateRunnerId.get(runner.providerRunnerId);
    const observedRow = observedRowByRunnerId.get(runner.providerRunnerId);
    const reason =
      authorizationByRunnerId.get(runner.providerRunnerId) ??
      observedRow?.terminationReason ??
      null;
    const hasFreshHealthyJob =
      runner.boundJobExecution !== null &&
      runner.boundJobExecution.cancellationRequestedAt === null &&
      runner.state !== null &&
      !isTerminalState(runner.state);
    const effectiveReason = hasFreshHealthyJob
      ? null
      : (reason ??
        (candidateAuthorization?.desiredIntent === 'terminate'
          ? candidateAuthorization.terminationReason
          : null));
    return {
      ...runner,
      desiredIntent: (effectiveReason ? 'terminate' : 'keep') as ReconcileDesiredIntent,
      desiredIntentReason: effectiveReason,
      terminationReason: effectiveReason,
    };
  });
  for (const runner of runners) {
    if (runner.desiredIntentReason && newlyAuthorizedRunnerIds.has(runner.providerRunnerId)) {
      providerRunnerTerminateIntentIssuedCount.add(1, {
        surface: 'reconcile',
        reason: runner.desiredIntentReason,
      });
    }
  }

  return {
    runners,
    terminatedAbsentRunnerInstanceIds: result.absentIds,
  };
}

export function reconcileRunnerInstancesFromDbResult(params: {
  observedRunnerInstanceIds: string[];
  observedRows: RunnerInstance[];
  boundJobExecutionsByRunnerInstanceId: Map<string, RunnerInstanceBoundJobExecution>;
  cleanupGraceSeconds?: number;
  now?: Date;
}): ReconciledRunnerInstance[] {
  const now = params.now ?? new Date();
  const cleanupGraceSeconds = params.cleanupGraceSeconds ?? config.RUNNER_JOB_CLEANUP_GRACE_SECONDS;
  const rowsByRunnerInstanceId = new Map(
    params.observedRows.map((row) => [row.providerRunnerId, row]),
  );

  return params.observedRunnerInstanceIds.map((providerRunnerId) => {
    const row = rowsByRunnerInstanceId.get(providerRunnerId);
    const boundJobExecution = params.boundJobExecutionsByRunnerInstanceId.get(providerRunnerId);

    const desiredIntentReason = getDesiredIntentReason(
      row,
      boundJobExecution,
      now,
      cleanupGraceSeconds,
    );

    return {
      providerRunnerId,
      state: row?.state ?? null,
      intendedReservationId: row?.intendedReservationId ?? null,
      reservationId: row?.reservationId ?? null,
      runnerSessionId: row?.runnerSessionId ?? null,
      stoppingAt: row?.stoppingAt ?? null,
      boundJobExecution: boundJobExecution
        ? toReconciledBoundJobExecution(boundJobExecution)
        : null,
      desiredIntent: desiredIntentReason ? 'terminate' : 'keep',
      desiredIntentReason,
      terminationReason: null,
    };
  });
}

export async function listActiveRunners(params: {workspaceId: string}): Promise<ActiveRunner[]> {
  const [providerRunnerRows, jobExecutionRows] = await Promise.all([
    listActiveRunnerInstances({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
    listActiveRunningJobExecutions({
      workspaceId: params.workspaceId,
      windowSeconds: config.RUNNER_ACTIVE_WINDOW_SECONDS,
    }),
  ]);

  return mergeActiveRunners(providerRunnerRows, jobExecutionRows);
}

function toReconciledBoundJobExecution(
  jobExecution: RunnerInstanceBoundJobExecution,
): ReconciledBoundJobExecution {
  return {
    jobId: jobExecution.jobId,
    jobExecutionId: jobExecution.jobExecutionId,
    workflowRunAttemptId: jobExecution.workflowRunAttemptId,
    lastHeartbeatAt: jobExecution.lastHeartbeatAt,
    cancellationRequestedAt: jobExecution.cancellationRequestedAt,
    cancellationReason: jobExecution.cancellationReason,
  };
}

function getDesiredIntentReason(
  row: RunnerInstance | undefined,
  boundJobExecution: RunnerInstanceBoundJobExecution | undefined,
  now = new Date(),
  cleanupGraceSeconds = config.RUNNER_JOB_CLEANUP_GRACE_SECONDS,
): RunnerTerminationReason | null {
  if (!row) return null;
  if (row.terminationAuthorizedAt && row.terminationReason) return row.terminationReason;
  const jobStopReason = terminationReasonForJobStop(boundJobExecution);
  const localWorkStopped = isTerminalState(row.state);
  const cleanupGraceStartedAt = cleanupGraceStart(boundJobExecution);
  const cleanupGraceExpired =
    cleanupGraceStartedAt !== null &&
    now.getTime() >= cleanupGraceStartedAt.getTime() + cleanupGraceSeconds * 1000;
  if (jobStopReason && (localWorkStopped || cleanupGraceExpired)) return jobStopReason;
  if (localWorkStopped) return 'terminal-state';
  return null;
}

function cleanupGraceStart(jobExecution: JobStopExecution | undefined): Date | null {
  return jobExecution?.cancellationRequestedAt ?? null;
}

function terminationReasonForJobStop(
  jobExecution: JobStopExecution | undefined,
): Extract<RunnerTerminationReason, 'job-cancelled' | 'job-timeout'> | null {
  if (!jobExecution?.cancellationRequestedAt) return null;
  if (jobExecution.cancellationReason === 'timed_out') return 'job-timeout';
  if (jobExecution.cancellationReason === 'run_cancelled') return 'job-cancelled';
  return null;
}

function mergeActiveRunners(
  providerRunners: RunnerInstance[],
  jobExecutions: ActiveRunningJobExecution[],
): ActiveRunner[] {
  const {bySessionId, byInstanceId} = indexActiveJobExecutions(jobExecutions);

  const merged: ActiveRunner[] = [];
  const usedJobExecutionIds = new Set<string>();

  for (const providerRunner of providerRunners) {
    appendActiveProviderRunner(
      providerRunner,
      bySessionId,
      byInstanceId,
      usedJobExecutionIds,
      merged,
    );
  }

  for (const jobExecution of jobExecutions) {
    if (usedJobExecutionIds.has(jobExecution.jobExecutionId)) continue;
    merged.push(toActiveRunner(undefined, jobExecution));
  }

  return merged.sort(compareActiveRunners);
}

function indexActiveJobExecutions(jobExecutions: readonly ActiveRunningJobExecution[]): {
  bySessionId: Map<string, ActiveRunningJobExecution[]>;
  byInstanceId: Map<string, ActiveRunningJobExecution[]>;
} {
  const bySessionId = new Map<string, ActiveRunningJobExecution[]>();
  const byInstanceId = new Map<string, ActiveRunningJobExecution[]>();
  for (const execution of jobExecutions) {
    appendActiveExecution(bySessionId, execution.runnerSessionId, execution);
    if (execution.provisionerId && execution.providerRunnerId) {
      appendActiveExecution(
        byInstanceId,
        providerRunnerKey(execution.provisionerId, execution.providerRunnerId),
        execution,
      );
    }
  }
  return {bySessionId, byInstanceId};
}

function appendActiveExecution(
  map: Map<string, ActiveRunningJobExecution[]>,
  key: string,
  execution: ActiveRunningJobExecution,
): void {
  const executions = map.get(key) ?? [];
  executions.push(execution);
  map.set(key, executions);
}

function appendActiveProviderRunner(
  runner: RunnerInstance,
  bySessionId: ReadonlyMap<string, readonly ActiveRunningJobExecution[]>,
  byInstanceId: ReadonlyMap<string, readonly ActiveRunningJobExecution[]>,
  usedJobExecutionIds: Set<string>,
  merged: ActiveRunner[],
): void {
  const executions = activeProviderRunnerExecutions(runner, bySessionId, byInstanceId);
  let emitted = false;
  for (const execution of executions) {
    if (usedJobExecutionIds.has(execution.jobExecutionId)) continue;
    usedJobExecutionIds.add(execution.jobExecutionId);
    merged.push(toActiveRunner(runner, execution));
    emitted = true;
  }
  if (!emitted) merged.push(toActiveRunner(runner, undefined));
}

function activeProviderRunnerExecutions(
  runner: RunnerInstance,
  bySessionId: ReadonlyMap<string, readonly ActiveRunningJobExecution[]>,
  byInstanceId: ReadonlyMap<string, readonly ActiveRunningJobExecution[]>,
): readonly ActiveRunningJobExecution[] {
  const instanceExecutions = byInstanceId.get(
    providerRunnerKey(runner.provisionerId, runner.providerRunnerId),
  );
  if (instanceExecutions !== undefined) return instanceExecutions;
  if (!runner.runnerSessionId) return [];
  return bySessionId.get(runner.runnerSessionId) ?? [];
}

function providerRunnerKey(provisionerId: string, providerRunnerId: string): string {
  return `${provisionerId}:${providerRunnerId}`;
}

function toActiveRunner(
  providerRunner: RunnerInstance | undefined,
  jobExecution: ActiveRunningJobExecution | undefined,
): ActiveRunner {
  return {
    runnerSessionId: providerRunner?.runnerSessionId ?? jobExecution?.runnerSessionId ?? null,
    providerRunnerId: providerRunner?.providerRunnerId ?? jobExecution?.providerRunnerId ?? null,
    provisionerId: providerRunner?.provisionerId ?? jobExecution?.provisionerId ?? null,
    state: jobExecution ? 'busy' : toActiveRunnerState(providerRunner?.state ?? 'running'),
    labels: providerRunner?.labels ?? jobExecution?.runnerLabels ?? [],
    templateKey: providerRunner?.templateKey ?? null,
    providerKind: providerRunner?.providerKind ?? null,
    jobId: jobExecution?.jobId ?? null,
    workflowRunAttemptId: jobExecution?.workflowRunAttemptId ?? null,
    projectId: jobExecution?.projectId ?? null,
    reportedAt: providerRunner?.reportedAt ?? null,
    lastHeartbeatAt: jobExecution?.lastHeartbeatAt ?? null,
  };
}

function toActiveRunnerState(state: RunnerInstanceState): ActiveRunnerState {
  if (state === 'starting' || state === 'stopping') return state;
  return 'running';
}

function compareActiveRunners(a: ActiveRunner, b: ActiveRunner): number {
  const aTime = Math.max(a.lastHeartbeatAt?.getTime() ?? 0, a.reportedAt?.getTime() ?? 0);
  const bTime = Math.max(b.lastHeartbeatAt?.getTime() ?? 0, b.reportedAt?.getTime() ?? 0);
  return bTime - aTime;
}
