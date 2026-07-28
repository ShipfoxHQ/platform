import type {RunnerAdministratorInstance} from '#core/admin-runner-instances.js';

export function toRunnerAdministratorInstanceDto(runner: RunnerAdministratorInstance) {
  return {
    id: runner.id,
    lifecycle_state: runner.lifecycleState,
    compute_state: runner.computeState,
    enrollment_state: runner.enrollmentState,
    assignment_presence: runner.assignmentPresence,
    assigned_workspace: runner.assignedWorkspace,
    labels: runner.labels,
    created_at: runner.createdAt.toISOString(),
    last_heartbeat_at: runner.lastHeartbeatAt.toISOString(),
    closure_reason: runner.closureReason,
    closed_at: runner.closedAt?.toISOString() ?? null,
    provisioner: runner.provisioner,
    reconciliation_status: runner.reconciliationStatus,
  };
}
