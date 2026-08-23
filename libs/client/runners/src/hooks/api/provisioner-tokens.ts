import {
  createProvisionerTokenResponseSchema,
  listActiveProvisionersResponseSchema,
  listProvisionerTokensResponseSchema,
  revokeProvisionerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  queryOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  ActiveProvisioners,
  ActiveProvisionersResponse,
  CreatedProvisionerToken,
  CreateTokenCommand,
  InstallationRunnersStatus,
  ProvisionerToken,
} from '#core/token.js';
import {
  toActiveProvisionersResponse,
  toCreatedProvisionerToken,
  toCreateTokenBody,
  toProvisionerToken,
} from './token-mapper.js';

const PROVISIONER_TOKEN_REFETCH_INTERVAL_MS = 30_000;

export const provisionerTokenQueryKeys = {
  all: ['provisioner-tokens'] as const,
  list: (workspaceId: string) => [...provisionerTokenQueryKeys.all, 'tokens', workspaceId] as const,
  active: (workspaceId: string) =>
    [...provisionerTokenQueryKeys.all, 'provisioners', workspaceId] as const,
};

type ProvisionerTokensQueryOptions = UseQueryOptions<
  ProvisionerToken[],
  Error,
  ProvisionerToken[],
  ReturnType<typeof provisionerTokenQueryKeys.list>
>;

type ActiveProvisionersQueryOptions = UseQueryOptions<
  ActiveProvisionersResponse,
  Error,
  ActiveProvisioners,
  ReturnType<typeof provisionerTokenQueryKeys.active>
>;

type InstallationRunnersStatusQueryOptions = UseQueryOptions<
  ActiveProvisionersResponse,
  Error,
  InstallationRunnersStatus,
  ReturnType<typeof provisionerTokenQueryKeys.active>
>;

export async function listProvisionerTokens({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ProvisionerToken[]> {
  const response = await checkedApiRequest(
    listProvisionerTokensResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {signal},
  );
  return response.tokens.map(toProvisionerToken);
}

export async function createProvisionerToken({
  workspaceId,
  command,
}: {
  workspaceId: string;
  command: CreateTokenCommand;
}): Promise<CreatedProvisionerToken> {
  const response = await checkedApiRequest(
    createProvisionerTokenResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens`,
    {method: 'POST', body: toCreateTokenBody(command)},
  );
  return toCreatedProvisionerToken(response);
}

export async function revokeProvisionerToken({
  workspaceId,
  tokenId,
}: {
  workspaceId: string;
  tokenId: string;
}): Promise<ProvisionerToken> {
  const response = await checkedApiRequest(
    revokeProvisionerTokenResponseSchema,
    `/workspaces/${workspaceId}/provisioners/tokens/${tokenId}/revoke`,
    {method: 'POST'},
  );
  return toProvisionerToken(response);
}

export async function listActiveProvisionersResponse({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ActiveProvisionersResponse> {
  const response = await checkedApiRequest(
    listActiveProvisionersResponseSchema,
    `/workspaces/${workspaceId}/provisioners/active`,
    {signal},
  );
  return toActiveProvisionersResponse(response);
}

export async function listActiveProvisioners({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<ActiveProvisioners> {
  const response = await listActiveProvisionersResponse({
    workspaceId,
    ...(signal ? {signal} : {}),
  });
  return response.provisioners;
}

export function provisionerTokensQueryOptions(workspaceId: string): ProvisionerTokensQueryOptions {
  return queryOptions({
    queryKey: provisionerTokenQueryKeys.list(workspaceId),
    queryFn: ({signal}) => listProvisionerTokens({workspaceId, signal}),
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function activeProvisionersQueryOptions(
  workspaceId: string,
): ActiveProvisionersQueryOptions {
  return {
    queryKey: provisionerTokenQueryKeys.active(workspaceId),
    queryFn: ({signal}) =>
      listActiveProvisionersResponse({workspaceId, ...(signal ? {signal} : {})}),
    select: (response) => response.provisioners,
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  };
}

export function installationRunnersStatusQueryOptions(
  workspaceId: string,
): InstallationRunnersStatusQueryOptions {
  return {
    queryKey: provisionerTokenQueryKeys.active(workspaceId),
    queryFn: ({signal}) =>
      listActiveProvisionersResponse({workspaceId, ...(signal ? {signal} : {})}),
    select: (response) => response.installationRunners,
    refetchInterval: PROVISIONER_TOKEN_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  };
}

export function useProvisionerTokensQuery(workspaceId: string | undefined) {
  return useQuery({
    ...provisionerTokensQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useActiveProvisionersQuery(workspaceId: string | undefined) {
  return useQuery<
    ActiveProvisionersResponse,
    Error,
    ActiveProvisioners,
    ReturnType<typeof provisionerTokenQueryKeys.active>
  >({
    ...activeProvisionersQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useInstallationRunnersStatusQuery(workspaceId: string | undefined) {
  return useQuery<
    ActiveProvisionersResponse,
    Error,
    InstallationRunnersStatus,
    ReturnType<typeof provisionerTokenQueryKeys.active>
  >({
    ...installationRunnersStatusQueryOptions(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateProvisionerTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateTokenCommand) => createProvisionerToken({workspaceId, command}),
    onSuccess: async () => {
      await queryClient.invalidateQueries(provisionerTokensQueryOptions(workspaceId));
    },
  });
}

export function useRevokeProvisionerTokenMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => revokeProvisionerToken({workspaceId, tokenId}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries(provisionerTokensQueryOptions(workspaceId)),
        queryClient.invalidateQueries(activeProvisionersQueryOptions(workspaceId)),
      ]);
    },
  });
}
