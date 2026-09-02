import {
  type AgentGrantSummaryRecord,
  listAgentGrantSummaries,
  revokeAgentGrantForUser,
} from '#db/agent-access.js';
import type {AgentGrant} from './entities/agent-access.js';
import {AgentGrantNotFoundError} from './errors.js';

export type AgentGrantSummary = AgentGrantSummaryRecord;

export async function listAgentGrants(params: {userId: string}): Promise<AgentGrantSummary[]> {
  return await listAgentGrantSummaries(params);
}

export async function revokeAgentGrant(params: {
  userId: string;
  grantId: string;
}): Promise<AgentGrant> {
  const grant = await revokeAgentGrantForUser(params);
  if (!grant) throw new AgentGrantNotFoundError();
  return grant;
}
