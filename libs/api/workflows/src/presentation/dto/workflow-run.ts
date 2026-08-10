import type {
  WorkflowRunAttemptDto,
  WorkflowRunDto,
  WorkflowRunListItemDto,
  WorkflowRunTriggerReferenceDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowRun, WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import type {WorkflowRunAttempt} from '#core/entities/workflow-run-attempt.js';
import type {WorkflowRunJobsSummary} from '#db/index.js';

export function toRunDto(run: WorkflowRun, latestAttempt = run.currentAttempt): WorkflowRunDto {
  return {
    id: run.id,
    project_id: run.projectId,
    definition_id: run.definitionId,
    number: run.number,
    name: run.name,
    workflow_name: run.workflowName,
    status: run.status,
    current_attempt: run.currentAttempt,
    latest_attempt: latestAttempt,
    trigger_provider: run.triggerProvider,
    trigger_source: run.triggerSource,
    trigger_event: run.triggerEvent,
    trigger_payload: run.triggerPayload,
    trigger_reference: toTriggerReferenceDto(run.triggerReference),
    inputs: run.inputs,
    source_snapshot: run.sourceSnapshot,
    created_at: run.createdAt.toISOString(),
    updated_at: run.updatedAt.toISOString(),
    started_at: run.startedAt?.toISOString() ?? null,
    finished_at: run.finishedAt?.toISOString() ?? null,
  };
}

const EMPTY_JOBS: WorkflowRunJobsSummary = {
  preview: [],
  statusCounts: [],
  rawStatusCounts: [],
  hasStartedJobExecution: false,
};

export function toRunListItemDto(
  run: WorkflowRun,
  jobs: WorkflowRunJobsSummary = EMPTY_JOBS,
): WorkflowRunListItemDto {
  return {
    ...toRunDto(run),
    jobs: jobs.preview.map((job) => ({
      id: job.id,
      key: job.key,
      name: job.name,
      status: job.status,
      mode: job.mode,
      listener_status: job.listenerStatus,
      execution_status: job.executionStatus,
      position: job.position,
    })),
    job_status_counts: jobs.rawStatusCounts.map(({status, count}) => ({status, count})),
    job_display_status_counts: jobs.statusCounts.map(({status, count}) => ({status, count})),
    has_started_job_execution: jobs.hasStartedJobExecution,
  };
}

// The persisted reference predates `actor` and carries an internal project id the client has
// no use for, so each field is read defensively rather than spread onto the response.
function toTriggerReferenceDto(
  reference: WorkflowRunTriggerReference | null | undefined,
): WorkflowRunTriggerReferenceDto | null {
  if (!reference) return null;
  return {
    repository: reference.repository ?? null,
    ref: reference.ref ?? null,
    commit: reference.commit ?? null,
    actor: reference.actor ?? null,
  };
}

export function toRunAttemptDto(attempt: WorkflowRunAttempt): WorkflowRunAttemptDto {
  return {
    id: attempt.id,
    workflow_run_id: attempt.workflowRunId,
    attempt: attempt.attempt,
    status: attempt.status,
    created_at: attempt.createdAt.toISOString(),
    started_at: attempt.startedAt?.toISOString() ?? null,
    finished_at: attempt.finishedAt?.toISOString() ?? null,
    rerun_mode: attempt.rerunMode,
  };
}
