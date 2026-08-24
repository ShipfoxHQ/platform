export const AGENT_SESSION_LIFECYCLE_TASK_QUEUE = 'agent-session-lifecycle';

// Bounded per tick; remaining stale claims are picked up on the next cron run.
export const AGENT_SESSION_REAP_BATCH_LIMIT = 100;
