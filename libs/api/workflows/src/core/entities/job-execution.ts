import type {JobStatus, JobStatusReason} from './job.js';
import type {PersistedEvaluationTraceEntry} from './step.js';
import type {WorkflowRunTriggerReference} from './workflow-run.js';

export type JobExecutionStatus = Exclude<JobStatus, 'skipped'>;

export interface WorkflowExecutionEvent {
  source: string;
  event: string;
  delivery_id: string;
  received_at: string;
  project: WorkflowRunTriggerReference['project'];
  repository: WorkflowRunTriggerReference['repository'];
  ref: WorkflowRunTriggerReference['ref'];
  commit: WorkflowRunTriggerReference['commit'];
  data: unknown;
}

export function normalizeWorkflowExecutionEvent(
  event: Omit<WorkflowExecutionEvent, 'project' | 'repository' | 'ref' | 'commit'> &
    Partial<Pick<WorkflowExecutionEvent, 'project' | 'repository' | 'ref' | 'commit'>>,
): WorkflowExecutionEvent {
  return {
    source: event.source,
    event: event.event,
    delivery_id: event.delivery_id,
    received_at: event.received_at,
    project: event.project ?? null,
    repository: event.repository ?? null,
    ref: event.ref ?? null,
    commit: event.commit ?? null,
    data: event.data,
  };
}

export interface JobExecution {
  id: string;
  jobId: string;
  sequence: number;
  /** A dynamically resolved name; null means use the parent job's fallback. */
  nameOverride: string | null;
  name: string;
  runner: string[] | null;
  status: JobExecutionStatus;
  statusReason: JobStatusReason | null;
  statusReasonMessage?: string | null;
  triggerEvents: WorkflowExecutionEvent[];
  outputs: Record<string, unknown> | null;
  evaluationTrace?: readonly PersistedEvaluationTraceEntry[] | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  timedOutAt: Date | null;
}
