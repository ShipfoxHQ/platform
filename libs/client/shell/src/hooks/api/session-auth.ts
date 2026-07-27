import {loginResponseSchema} from '@shipfox/api-auth-dto';
import {listUserWorkspacesResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {type FetchQueryOptions, queryOptions} from '@tanstack/react-query';
import type {AuthenticatedSession, WorkspaceSummary} from '#core/session.js';
import {toAuthenticatedSession} from './session-mapper.js';

export interface UserWorkspaces {
  memberships: WorkspaceSummary[];
}

export const authRefreshQueryKey = ['auth', 'refresh'] as const;
export const userWorkspacesQueryKey = ['workspaces', 'mine'] as const;

type AuthRefreshQueryOptions = FetchQueryOptions<
  AuthenticatedSession,
  Error,
  AuthenticatedSession,
  typeof authRefreshQueryKey
>;

type UserWorkspacesQueryOptions = FetchQueryOptions<
  UserWorkspaces,
  Error,
  UserWorkspaces,
  typeof userWorkspacesQueryKey
>;

export async function listUserWorkspaces(
  token?: string,
  signal?: AbortSignal,
): Promise<UserWorkspaces> {
  const response = await checkedApiRequest(
    listUserWorkspacesResponseSchema,
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}, signal} : {signal},
  );
  return {
    memberships: response.memberships.map((membership) => ({
      id: membership.workspace_id,
      name: membership.workspace_name,
      membershipId: membership.id,
      status: membership.workspace_status,
    })),
  };
}

export function authRefreshQueryOptions(): AuthRefreshQueryOptions {
  return queryOptions({
    queryKey: authRefreshQueryKey,
    queryFn: ({signal}) => refreshAuthenticatedSession(signal),
    retry: false,
    staleTime: 0,
  });
}

export function userWorkspacesQueryOptions(token?: string): UserWorkspacesQueryOptions {
  return queryOptions({
    queryKey: userWorkspacesQueryKey,
    queryFn: ({signal}) => listUserWorkspaces(token, signal),
    retry: false,
    staleTime: 0,
  });
}

export async function refreshAuthenticatedSession(
  signal?: AbortSignal,
): Promise<AuthenticatedSession> {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/refresh', {
    method: 'POST',
    signal,
  });
  return toAuthenticatedSession(response);
}
