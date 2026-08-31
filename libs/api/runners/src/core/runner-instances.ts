import type {RunnerJobStopReasonDto} from '@shipfox/api-runners-dto';
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
  recordRunnerReservationReleased,
} from '#metrics/instance.js';
import {config} from '../config.js';
import {
  authorizeRunnerTermination,
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

export interface ReconcileRunnerInstancesParams {
  workspaceId: string | null;
  provisionerId: string;
  observedRunnerInstanceIds: string[];
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

export interface ReconciledRunnerInstance {
  providerRunnerId: string;
  state: RunnerInstanceState | null;
  intendedReservationId: string | null;
  reservationId: string | null;
  runnerSessionId: string | null;
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
  const providerKindByRunnerId = new Map(
    params.events.map((event) => [event.providerRunnerId, event.providerKind]),
  );
  const honoredIntents = new Map(
    result.terminateIntentsHonored.map((intent) => [intent.providerRunnerId, intent]),
  );
  for (const intent of honoredIntents.values()) {
    providerRunnerTerminateIntentHonoredCount.add(1, {reason: intent.reason});
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
  recordRunnerReservationReleased({count: result.reservationsReleased, surface: 'terminal-report'});

  return result;
}

export async function reconcileRunnerInstances(
  params: ReconcileRunnerInstancesParams,
): Promise<ReconcileRunnerInstancesResult> {
  const result = await reconcileRunnerInstancesDb({
    ...params,
    terminateGraceSeconds: config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS,
    postJobExitGraceSeconds: config.RUNNER_POST_JOB_EXIT_GRACE_SECONDS,
    terminationReasonResolver: ({provisionerId, providerRunnerId, reason}) =>
      resolveRunnerTerminationReason({provisionerId, providerRunnerId, reason}),
  });

  recordRunnerReservationReleased({count: result.reservationsReleased, surface: 'reconcile'});
  providerRunnerReconcileCallCount.add(1);
  if (result.absentIds.length > 0) providerRunnerAbsentTerminatedCount.add(result.absentIds.length);

  const reconciledRunners = reconcileRunnerInstancesFromDbResult({
    observedRunnerInstanceIds: params.observedRunnerInstanceIds,
    observedRows: result.observedRows,
    boundJobExecutionsByRunnerInstanceId: result.boundJobExecutionsByRunnerInstanceId,
  });
  // Compatibility adapter for the old terminal-state decision. Cancellation
  // and timeout are intentionally not authorized until graceful cleanup exists.
  const terminalAuthorizations = await Promise.all(
    reconciledRunners.flatMap((runner) =>
      runner.desiredIntentReason === 'terminal-state'
        ? [
            authorizeRunnerTermination({
              provisionerId: params.provisionerId,
              providerRunnerId: runner.providerRunnerId,
              reason: runner.desiredIntentReason,
            }).then((authorization) => [runner.providerRunnerId, authorization] as const),
          ]
        : [],
    ),
  );
  const terminalAuthorizationByRunnerId = new Map(terminalAuthorizations);
  const authorizations = await listProvisionerTerminationAuthorizations({
    workspaceId: params.workspaceId,
    provisionerId: params.provisionerId,
    providerRunnerIds: params.observedRunnerInstanceIds,
    limit: params.observedRunnerInstanceIds.length,
  });
  const authorizationByRunnerId = new Map(
    authorizations.map((authorization) => [authorization.providerRunnerId, authorization.reason]),
  );
  const runners = reconciledRunners.map((runner) => {
    const authorization = terminalAuthorizationByRunnerId.get(runner.providerRunnerId);
    const reason = authorizationByRunnerId.get(runner.providerRunnerId);
    const effectiveReason =
      reason ??
      (authorization?.desiredIntent === 'terminate' ? authorization.terminationReason : null);
    return {
      ...runner,
      desiredIntent: (effectiveReason ? 'terminate' : 'keep') as ReconcileDesiredIntent,
      desiredIntentReason: effectiveReason,
      terminationReason:
        reason ??
        (authorization?.desiredIntent === 'terminate' ? authorization.terminationReason : null),
    };
  });
  for (const runner of runners) {
    if (runner.desiredIntentReason) {
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
}): ReconciledRunnerInstance[] {
  const rowsByRunnerInstanceId = new Map(
    params.observedRows.map((row) => [row.providerRunnerId, row]),
  );

  return params.observedRunnerInstanceIds.map((providerRunnerId) => {
    const row = rowsByRunnerInstanceId.get(providerRunnerId);
    const boundJobExecution = params.boundJobExecutionsByRunnerInstanceId.get(providerRunnerId);

    const desiredIntentReason = getDesiredIntentReason(row, boundJobExecution);

    return {
      providerRunnerId,
      state: row?.state ?? null,
      intendedReservationId: row?.intendedReservationId ?? null,
      reservationId: row?.reservationId ?? null,
      runnerSessionId: row?.runnerSessionId ?? null,
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

export function desiredIntent(
  row: RunnerInstance | undefined,
  boundJobExecution: RunnerInstanceBoundJobExecution | undefined,
): ReconcileDesiredIntent {
  return getDesiredIntentReason(row, boundJobExecution) ? 'terminate' : 'keep';
}

function getDesiredIntentReason(
  row: RunnerInstance | undefined,
  boundJobExecution: RunnerInstanceBoundJobExecution | undefined,
): RunnerTerminationReason | null {
  if (!row) return null;
  if (isTerminalState(row.state)) return 'terminal-state';
  if (boundJobExecution?.cancellationRequestedAt) return 'job-cancelled';
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
