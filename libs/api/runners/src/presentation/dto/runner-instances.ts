import type {
  ActiveRunner,
  ReconcileRunnerInstancesResult,
  ReportRunnerInstancesResult,
} from '#core/runner-instances.js';

export function toReportRunnerInstancesResponseDto(result: ReportRunnerInstancesResult): {
  accepted: number;
  reservations_released: number;
} {
  return {
    accepted: result.accepted,
    reservations_released: result.reservationsReleased,
  };
}

export function toReconcileRunnerInstancesResponseDto(
  result: ReconcileRunnerInstancesResult,
  options: {includeIntendedReservationId: boolean},
): {
  runners: Array<{
    provider_runner_id: string;
    state: ReconcileRunnerInstancesResult['runners'][number]['state'];
    intended_reservation_id?: string | null;
    reservation_id: string | null;
    runner_session_id: string | null;
    stopping_at?: string;
    bound_job: {
      job_id: string;
      workflow_run_attempt_id: string;
      last_heartbeat_at: string;
      cancellation_requested_at: string | null;
      cancellation_reason?: 'run_cancelled' | 'timed_out' | null;
    } | null;
    desired_intent: ReconcileRunnerInstancesResult['runners'][number]['desiredIntent'];
    termination_reason?: ReconcileRunnerInstancesResult['runners'][number]['terminationReason'];
  }>;
  terminated_absent_provider_runner_ids: string[];
} {
  return {
    runners: result.runners.map((runner) => ({
      provider_runner_id: runner.providerRunnerId,
      state: runner.state,
      ...(options.includeIntendedReservationId
        ? {intended_reservation_id: runner.intendedReservationId}
        : {}),
      reservation_id: runner.reservationId,
      runner_session_id: runner.runnerSessionId,
      ...(runner.stoppingAt ? {stopping_at: runner.stoppingAt.toISOString()} : {}),
      bound_job: runner.boundJobExecution
        ? {
            job_id: runner.boundJobExecution.jobId,
            workflow_run_attempt_id: runner.boundJobExecution.workflowRunAttemptId,
            last_heartbeat_at: runner.boundJobExecution.lastHeartbeatAt.toISOString(),
            cancellation_requested_at:
              runner.boundJobExecution.cancellationRequestedAt?.toISOString() ?? null,
            ...(runner.boundJobExecution.cancellationReason === null
              ? {}
              : {cancellation_reason: runner.boundJobExecution.cancellationReason}),
          }
        : null,
      desired_intent: runner.desiredIntent,
      ...(runner.terminationReason ? {termination_reason: runner.terminationReason} : {}),
    })),
    terminated_absent_provider_runner_ids: result.terminatedAbsentRunnerInstanceIds,
  };
}

export function toActiveRunnersResponseDto(runners: ActiveRunner[]): {
  runners: Array<{
    runner_session_id: string | null;
    provider_runner_id: string | null;
    provisioner_id: string | null;
    state: ActiveRunner['state'];
    labels: string[];
    template_key: string | null;
    provider_kind: string | null;
    job_id: string | null;
    workflow_run_attempt_id: string | null;
    project_id: string | null;
    reported_at: string | null;
    last_heartbeat_at: string | null;
  }>;
} {
  return {
    runners: runners.map((runner) => ({
      runner_session_id: runner.runnerSessionId,
      provider_runner_id: runner.providerRunnerId,
      provisioner_id: runner.provisionerId,
      state: runner.state,
      labels: runner.labels,
      template_key: runner.templateKey,
      provider_kind: runner.providerKind,
      job_id: runner.jobId,
      workflow_run_attempt_id: runner.workflowRunAttemptId,
      project_id: runner.projectId,
      reported_at: runner.reportedAt?.toISOString() ?? null,
      last_heartbeat_at: runner.lastHeartbeatAt?.toISOString() ?? null,
    })),
  };
}
