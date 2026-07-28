import {config} from '#config.js';
import {
  type AdministratorRunnerInstanceRow,
  type ListAdministratorRunnerInstancesParams,
  listAdministratorRunnerInstances as listAdministratorRunnerInstanceRows,
} from '#db/admin-runner-instances.js';
import {isTerminalState} from '#db/runner-instances.js';

export type RunnerAdministratorLifecycleState =
  | 'unassigned'
  | 'assigned'
  | 'activated'
  | 'claimed'
  | 'completed';
export type RunnerAdministratorEnrollmentState = 'pending' | 'enrolled' | 'activated';
export type RunnerAdministratorReconciliationStatus = 'current' | 'stale' | 'terminal' | 'unknown';

export interface RunnerAdministratorInstance {
  id: string;
  lifecycleState: RunnerAdministratorLifecycleState;
  computeState: AdministratorRunnerInstanceRow['state'];
  enrollmentState: RunnerAdministratorEnrollmentState;
  assignmentPresence: 'assigned' | 'unassigned';
  assignedWorkspace: {id: string} | null;
  labels: string[];
  createdAt: Date;
  lastHeartbeatAt: Date;
  closureReason: string | null;
  closedAt: Date | null;
  provisioner: {
    id: string;
    scope: 'installation';
    name: string | null;
  };
  reconciliationStatus: RunnerAdministratorReconciliationStatus;
}

export interface ListRunnerAdministratorInstancesParams
  extends ListAdministratorRunnerInstancesParams {
  reconciliationStaleAfterSeconds?: number | undefined;
}

export interface ListRunnerAdministratorInstancesResult {
  runners: RunnerAdministratorInstance[];
  nextCursor: Awaited<ReturnType<typeof listAdministratorRunnerInstanceRows>>['nextCursor'];
}

export async function listRunnerAdministratorInstances(
  params: ListRunnerAdministratorInstancesParams,
): Promise<ListRunnerAdministratorInstancesResult> {
  const result = await listAdministratorRunnerInstanceRows(params);
  const staleAfterSeconds =
    params.reconciliationStaleAfterSeconds ??
    config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS;
  const now = new Date();

  return {
    runners: result.runners.map((row) =>
      toRunnerAdministratorInstance(row, {now, staleAfterSeconds}),
    ),
    nextCursor: result.nextCursor,
  };
}

function toRunnerAdministratorInstance(
  row: AdministratorRunnerInstanceRow,
  params: {now: Date; staleAfterSeconds: number},
): RunnerAdministratorInstance {
  const isAssigned = row.workspaceId !== null;
  const isActivated = row.runnerSessionId !== null;
  const hasClaim = row.firstClaimedAt !== null;
  const isTerminal = isTerminalState(row.state);

  return {
    id: row.id,
    lifecycleState: !isAssigned
      ? 'unassigned'
      : isTerminal
        ? 'completed'
        : !isActivated
          ? 'assigned'
          : !hasClaim
            ? 'activated'
            : 'claimed',
    computeState: row.state,
    enrollmentState: isActivated
      ? 'activated'
      : row.hasActiveControlSession
        ? 'enrolled'
        : 'pending',
    assignmentPresence: isAssigned ? 'assigned' : 'unassigned',
    assignedWorkspace: row.workspaceId ? {id: row.workspaceId} : null,
    labels: row.labels,
    createdAt: row.createdAt,
    lastHeartbeatAt: row.reportedAt,
    closureReason: row.reason,
    closedAt: closedAt(row),
    provisioner: {
      id: row.provisionerId,
      scope: 'installation',
      name: row.provisionerName,
    },
    reconciliationStatus: reconciliationStatus(row, params),
  };
}

function closedAt(row: AdministratorRunnerInstanceRow): Date | null {
  if (row.state === 'stopped') return row.stoppedAt;
  if (row.state === 'failed') return row.failedAt;
  if (row.state === 'terminated') return row.terminatedAt;
  return null;
}

function reconciliationStatus(
  row: AdministratorRunnerInstanceRow,
  params: {now: Date; staleAfterSeconds: number},
): RunnerAdministratorReconciliationStatus {
  if (isTerminalState(row.state)) return 'terminal';
  if (!row.provisionerLastSeenAt) return 'unknown';

  const cutoff = params.now.getTime() - params.staleAfterSeconds * 1000;
  const reportIsStale = row.reportedAt.getTime() <= cutoff;
  const provisionerIsStale = row.provisionerLastSeenAt.getTime() <= cutoff;
  return reportIsStale || provisionerIsStale ? 'stale' : 'current';
}
