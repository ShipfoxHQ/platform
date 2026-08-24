import type {SessionViewLifecycleRow, SessionViewRow} from '@shipfox/api-logs-dto';

/** Lifecycle state of an attempt's log stream. */
export type StreamState = 'open' | 'closed';

/** Why a stream was closed, once it is. */
export type StreamCloseReason = 'declared' | 'timeout';

/**
 * A single `(job, step, attempt)` log stream. Identity is scoped to the lease's
 * job. `workspaceId`, `projectId`, and `workflowRunAttemptId` are stamped from the lease on
 * stream creation and asserted on subsequent appends, so reads can authorize
 * per-project without joining back to workflows. `committedLength` is the active
 * writer's offset-CAS axis: raw or normalized NDJSON bytes the server has durably
 * accepted from the runner or server-origin writer.
 *
 * `truncated` is an out-of-band terminal flag set when the timeout sweep
 * force-closes a stream the runner never ended. Budget exhaustion ("capped") is a
 * job-level signal recorded in `job_accounting` and surfaced in-band by a `capped`
 * tombstone record, not on the stream row.
 */
export interface AttemptStream {
  id: string;
  jobId: string;
  stepId: string;
  attempt: number;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  committedLength: number;
  state: StreamState;
  closeReason: StreamCloseReason | null;
  declaredTotalBytes: number | null;
  claudeHasInit: boolean;
  claudeSessionId: string | null;
  claudeTurn: number;
  claudePendingResult: SessionViewLifecycleRow | null;
  claudePendingToolRows: SessionViewRow[];
  truncated: boolean;
  objectKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** When the stream was closed (either close path); null while open. Retention anchor. */
  closedAt: Date | null;
}
