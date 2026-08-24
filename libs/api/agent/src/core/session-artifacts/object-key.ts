export interface SessionObjectKeyParams {
  workspaceId: string;
  /** Run-scoped identity of the session: the workflow run attempt id. */
  workflowRunAttemptId: string;
  sessionId: string;
  segment: number;
}

const SEGMENT_PATTERN = /^\d+$/u;

/**
 * Object layout `{prefix}/{workspace}/{runAttempt}/{session}/{segment}` so
 * retention and session deletion are prefix operations. One immutable object
 * per commit; the segment is both the monotonic version counter and the CAS
 * token, never a browsable history. `prefix` is the configurable bucket prefix
 * (`AGENT_SESSION_STORAGE_S3_PREFIX`, default `agent-sessions`), so one bucket
 * can host several modules.
 */
export function sessionObjectKey(
  prefix: string,
  {workspaceId, workflowRunAttemptId, sessionId, segment}: SessionObjectKeyParams,
): string {
  return `${prefix}/${workspaceId}/${workflowRunAttemptId}/${sessionId}/${segment}`;
}

export interface ParsedSessionObjectKey {
  workspaceId: string;
  workflowRunAttemptId: string;
  sessionId: string;
  segment: number;
}

/**
 * Parses the segment (and identity) back out of an object key. Returns null for
 * keys that do not match the layout, so a stray object under a session prefix
 * is never misclassified or deleted by segment pruning.
 */
export function parseSessionObjectKey(key: string): ParsedSessionObjectKey | null {
  const parts = key.split('/');
  if (parts.length < 5) return null;

  const segment = parts.at(-1);
  if (segment === undefined || !SEGMENT_PATTERN.test(segment)) return null;

  const workspaceId = parts.at(-4);
  const workflowRunAttemptId = parts.at(-3);
  const sessionId = parts.at(-2);
  if (!workspaceId || !workflowRunAttemptId || !sessionId) return null;

  return {
    workspaceId,
    workflowRunAttemptId,
    sessionId,
    segment: Number.parseInt(segment, 10),
  };
}

export function sessionObjectKeyPrefix(
  prefix: string,
  params: {workspaceId: string; workflowRunAttemptId: string; sessionId: string},
): string {
  return `${prefix}/${params.workspaceId}/${params.workflowRunAttemptId}/${params.sessionId}`;
}
