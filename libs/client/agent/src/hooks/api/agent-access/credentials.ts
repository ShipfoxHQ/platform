import {
  createAgentPersonalAccessTokenResponseSchema,
  listAgentGrantsResponseSchema,
  listAgentPersonalAccessTokensResponseSchema,
} from '@shipfox/api-auth-dto';
import {checkedApiRequest, emptyResponseSchema} from '@shipfox/client-api';
import {
  type FetchQueryOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AgentGrant,
  AgentPersonalAccessToken,
  CreateAgentPersonalAccessTokenCommand,
  CreatedAgentPersonalAccessToken,
} from '#agent-access/core/agent-access.js';
import {
  toAgentGrant,
  toAgentPersonalAccessToken,
  toCreateAgentPersonalAccessTokenBody,
  toCreatedAgentPersonalAccessToken,
} from './mapper.js';

export const agentCredentialQueryKeys = {
  all: ['agent-access-credentials'] as const,
  grants: () => [...agentCredentialQueryKeys.all, 'grants'] as const,
  pats: () => [...agentCredentialQueryKeys.all, 'pats'] as const,
};

type AgentGrantsQueryOptions = FetchQueryOptions<
  AgentGrant[],
  Error,
  AgentGrant[],
  ReturnType<typeof agentCredentialQueryKeys.grants>
>;

type AgentPersonalAccessTokensQueryOptions = FetchQueryOptions<
  AgentPersonalAccessToken[],
  Error,
  AgentPersonalAccessToken[],
  ReturnType<typeof agentCredentialQueryKeys.pats>
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

export async function listAgentPersonalAccessTokens(
  signal?: AbortSignal,
): Promise<AgentPersonalAccessToken[]> {
  const response = await checkedApiRequest(
    listAgentPersonalAccessTokensResponseSchema,
    '/agent-access/pats',
    {signal},
  );
  return response.pats.map(toAgentPersonalAccessToken);
}

export async function createAgentPersonalAccessToken({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: CreateAgentPersonalAccessTokenCommand;
}): Promise<CreatedAgentPersonalAccessToken> {
  const response = await checkedApiRequest(
    createAgentPersonalAccessTokenResponseSchema,
    '/agent-access/pats',
    {method: 'POST', body: toCreateAgentPersonalAccessTokenBody(workspaceId, command)},
  );
  return toCreatedAgentPersonalAccessToken(response);
}

export async function revokeAgentPersonalAccessToken(id: string): Promise<void> {
  await checkedApiRequest(emptyResponseSchema, `/agent-access/pats/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export const agentGrantsQueryOptions = (): AgentGrantsQueryOptions =>
  queryOptions({
    queryKey: agentCredentialQueryKeys.grants(),
    queryFn: ({signal}) => listAgentGrants(signal),
  });

export const agentPersonalAccessTokensQueryOptions = (): AgentPersonalAccessTokensQueryOptions =>
  queryOptions({
    queryKey: agentCredentialQueryKeys.pats(),
    queryFn: ({signal}) => listAgentPersonalAccessTokens(signal),
  });

export function useAgentGrantsQuery() {
  return useQuery(agentGrantsQueryOptions());
}

export function useAgentPersonalAccessTokensQuery() {
  return useQuery(agentPersonalAccessTokensQueryOptions());
}

export function useRevokeAgentGrantMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAgentGrant,
    onSuccess: async () => queryClient.invalidateQueries(agentGrantsQueryOptions()),
  });
}

export function useCreateAgentPersonalAccessTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateAgentPersonalAccessTokenCommand) =>
      createAgentPersonalAccessToken({workspaceId, command}),
    onSuccess: async () => queryClient.invalidateQueries(agentPersonalAccessTokensQueryOptions()),
  });
}

export function useRevokeAgentPersonalAccessTokenMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeAgentPersonalAccessToken,
    onSuccess: async () => queryClient.invalidateQueries(agentPersonalAccessTokensQueryOptions()),
  });
}
