import type {Harness} from '@shipfox/api-agent-dto';

/**
 * One named agent session within a workflow run attempt. Sessions live and die
 * with the run: identity is scoped to `(workflowRunAttemptId, key)`, and the
 * row carries no cross-module foreign keys. `workspaceId`/`projectId` are
 * denormalized scope for self-contained authorization, as on log streams.
 *
 * The head pointer (`headSegment`, `headObjectKey`, `headSizeBytes`,
 * `headCommittedByAttempt`, `headRepoRef`) advances exactly once per reported
 * attempt through `commitSessionHead`; `headSegment` doubles as the monotonic
 * segment counter and the commit CAS token. The claim (`claimedByStepAttempt`,
 * `claimedAt`) is an exclusive-writer marker held from dispatch until the
 * attempt terminates.
 */
export interface AgentSession {
  id: string;
  workspaceId: string;
  projectId: string;
  workflowRunAttemptId: string;
  /** Resolved session key; must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. */
  key: string;
  /** Harness the session is pinned to at creation; pi and Claude transcripts are not interconvertible. */
  harness: Harness;
  /** Harness-native session id (Claude session UUID); null until the harness reports one. */
  harnessSessionId: string | null;
  /** Current head segment; 0 means no head committed yet. */
  headSegment: number;
  /** Storage key of the head transcript artifact; null while no head exists. */
  headObjectKey: string | null;
  /** Compressed size of the head transcript artifact. */
  headSizeBytes: number | null;
  /** Step-attempt id that committed the current head (retry-ack discriminator). */
  headCommittedByAttempt: string | null;
  /** Checkout ref the head segment ran on (preamble/audit metadata). */
  headRepoRef: string | null;
  /** Step-attempt id currently holding the exclusive claim; null when unclaimed. */
  claimedByStepAttempt: string | null;
  /** When the current claim was granted. */
  claimedAt: Date | null;
  /** Session row this one was carried over from on a rerun (provenance). */
  carriedFromSessionId: string | null;
  /** When the owning run attempt reached a terminal state (retention sweep horizon). */
  retiredAt: Date | null;
  /** Optimistic-lock counter, bumped on every mutation. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
