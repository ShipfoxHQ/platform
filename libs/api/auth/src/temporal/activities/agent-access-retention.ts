import {Context} from '@temporalio/activity';
import {pruneAgentAccessBatch} from '#db/agent-access.js';
import {
  AGENT_ACCESS_RETENTION_BATCH_LIMIT,
  AGENT_ACCESS_RETENTION_MAX_ITERATIONS,
  AGENT_ACCESS_RETENTION_TIME_BUDGET_MS,
} from '#db/agent-access-retention.js';

export interface AgentAccessRetentionResult {
  deleted: number;
  transitioned: number;
  iterations: number;
  timedOut: boolean;
}

/**
 * Drains bounded retention batches for the current tick. Heartbeats continue
 * while a database batch waits on a lock, and the wall-clock budget keeps the
 * activity inside its five-minute Temporal start-to-close timeout.
 */
export async function agentAccessRetentionActivity(): Promise<AgentAccessRetentionResult> {
  const ctx = Context.current();
  const startedAt = Date.now();
  const deadline = startedAt + AGENT_ACCESS_RETENTION_TIME_BUDGET_MS;
  const result: AgentAccessRetentionResult = {
    deleted: 0,
    transitioned: 0,
    iterations: 0,
    timedOut: false,
  };
  const heartbeat = () => ctx.heartbeat(result);
  const heartbeatTimer = setInterval(heartbeat, 15_000);

  try {
    while (result.iterations < AGENT_ACCESS_RETENTION_MAX_ITERATIONS) {
      if (Date.now() >= deadline) {
        result.timedOut = true;
        break;
      }

      const batch = await pruneAgentAccessBatch({limit: AGENT_ACCESS_RETENTION_BATCH_LIMIT});
      result.deleted += batch.deleted;
      result.transitioned += batch.transitioned;
      result.iterations += 1;
      heartbeat();

      if (batch.deleted === 0 && batch.transitioned === 0) break;
    }

    if (result.iterations >= AGENT_ACCESS_RETENTION_MAX_ITERATIONS) {
      result.timedOut = true;
    }
    heartbeat();
    return result;
  } finally {
    clearInterval(heartbeatTimer);
  }
}
