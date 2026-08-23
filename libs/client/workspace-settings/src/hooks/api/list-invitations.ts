import {listInvitationsResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import type {PendingInvitation} from '#core/membership.js';
import {toInvitation} from './invitation-mapper.js';

export const listInvitationsQueryKey = (workspaceId: string) =>
  ['workspaces', workspaceId, 'invitations'] as const;

type ListInvitationsQueryOptions = UseQueryOptions<
  PendingInvitation[],
  Error,
  PendingInvitation[],
  ReturnType<typeof listInvitationsQueryKey>
>;

async function listInvitations(workspaceId: string): Promise<PendingInvitation[]> {
  const response = await checkedApiRequest(
    listInvitationsResponseSchema,
    `/workspaces/${workspaceId}/invitations`,
  );
  return response.invitations.map(toInvitation);
}

export function listInvitationsQueryOptions(workspaceId: string): ListInvitationsQueryOptions {
  return queryOptions({
    queryKey: listInvitationsQueryKey(workspaceId),
    queryFn: () => listInvitations(workspaceId),
  });
}

export function useListInvitations(workspaceId: string) {
  return useQuery(listInvitationsQueryOptions(workspaceId));
}
