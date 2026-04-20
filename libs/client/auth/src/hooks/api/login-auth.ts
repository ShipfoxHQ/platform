import type {LoginBodyDto, LoginResponseDto} from '@shipfox/api-auth-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useSetAtom} from 'jotai';
import {authStateAtom, toAuthenticatedState} from '#state/auth.js';
import {authRefreshQueryKey} from './refresh-auth.js';
import {listUserWorkspaces, userWorkspacesQueryKey} from './workspace-auth.js';

async function loginAuth(body: LoginBodyDto) {
  return await apiRequest<LoginResponseDto>('/auth/login', {method: 'POST', body});
}

export function useLoginAuth() {
  const queryClient = useQueryClient();
  const setState = useSetAtom(authStateAtom);

  return useMutation({
    mutationFn: loginAuth,
    onSuccess: async (result) => {
      setState(toAuthenticatedState(result));
      queryClient.setQueryData(authRefreshQueryKey, result);
      try {
        const workspaces = await queryClient.fetchQuery({
          queryKey: userWorkspacesQueryKey,
          queryFn: () => listUserWorkspaces(result.token),
          retry: false,
          staleTime: 0,
        });
        setState(toAuthenticatedState(result, workspaces.memberships));
        queryClient.setQueryData(userWorkspacesQueryKey, workspaces);
      } catch {
        // The user is authenticated even if workspace hydration fails.
      }
    },
  });
}
