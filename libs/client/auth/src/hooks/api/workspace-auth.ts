import type {
  CreateWorkspaceBodyDto,
  ListUserWorkspacesResponseDto,
  WorkspaceResponseDto,
} from '@shipfox/api-workspaces-dto';
import {apiRequest} from '@shipfox/client-api';
import {useMutation} from '@tanstack/react-query';
import {useSetAtom} from 'jotai';
import {authStateAtom} from '#state/auth.js';

async function createWorkspace(body: CreateWorkspaceBodyDto) {
  return await apiRequest<WorkspaceResponseDto>('/workspaces', {method: 'POST', body});
}

export const userWorkspacesQueryKey = ['workspaces', 'mine'] as const;

export async function listUserWorkspaces(token?: string) {
  return await apiRequest<ListUserWorkspacesResponseDto>(
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}} : {},
  );
}

export function useCreateWorkspaceAuth() {
  const setState = useSetAtom(authStateAtom);

  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: async () => {
      const result = await listUserWorkspaces();
      setState((state) => {
        if (state.status !== 'authenticated') return state;

        return {
          ...state,
          workspaces: result.memberships.map((membership) => ({
            id: membership.workspace_id,
            name: membership.workspace_name,
            membershipId: membership.id,
          })),
        };
      });
    },
  });
}
