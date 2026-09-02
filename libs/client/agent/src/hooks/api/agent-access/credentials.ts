import {listAgentGrantsResponseSchema} from '@shipfox/api-auth-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {AgentGrant} from '#agent-access/core/agent-access.js';
import {toAgentGrant} from './mapper.js';

export const agentCredentialQueryKeys = {
  all: ['agent-access-credentials'] as const,
  grants: () => [...agentCredentialQueryKeys.all, 'grants'] as const,
};

type AgentGrantsQueryOptions = FetchQueryOptions<
  AgentGrant[],
  Error,
  AgentGrant[],
  ReturnType<typeof agentCredentialQueryKeys.grants>
>;

export async function listAgentGrants(signal?: AbortSignal): Promise<AgentGrant[]> {
  const response = await checkedApiRequest(listAgentGrantsResponseSchema, '/agent-access/grants', {
    signal,
  });
  return response.grants.map(toAgentGrant);
}

export async function revokeAgentGrant(id: string): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, `/agent-access/grants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export const agentGrantsQueryOptions = (): AgentGrantsQueryOptions =>
  queryOptions({
    queryKey: agentCredentialQueryKeys.grants(),
    queryFn: ({signal}) => listAgentGrants(signal),
  });

export function useAgentGrantsQuery() {
  return useQuery(agentGrantsQueryOptions());
}

export function useRevokeAgentGrantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAgentGrant,
    onSuccess: async () => queryClient.invalidateQueries(agentGrantsQueryOptions()),
  });
}
