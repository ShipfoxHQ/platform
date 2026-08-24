export const AGENT_SESSION_LIFECYCLE_TASK_QUEUE = 'agent-session-lifecycle';

// The wall-clock budget is the real sweep bound; Temporal's timeout does not stop JS
// already running in the worker.
export const SESSION_RETENTION_BATCH_LIMIT = 200;
export const SESSION_RETENTION_TIME_BUDGET_MS = 4 * 60_000;
export const SESSION_RETENTION_MAX_ITERATIONS = 1_000;
