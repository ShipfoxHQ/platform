import {Context} from '@temporalio/activity';
import {pruneAgentAccess} from '#db/agent-access.js';
import {AGENT_ACCESS_RETENTION_BATCH_LIMIT} from '#db/agent-access-retention.js';

export interface AgentAccessRetentionResult {
  deleted: number;
}

/** Runs one bounded agent-access lifecycle sweep and reports progress to Temporal. */
export async function agentAccessRetentionActivity(): Promise<AgentAccessRetentionResult> {
  const result = {deleted: await pruneAgentAccess({limit: AGENT_ACCESS_RETENTION_BATCH_LIMIT})};
  Context.current().heartbeat(result);
  return result;
}
