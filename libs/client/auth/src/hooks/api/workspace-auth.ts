import {
  updateWorkspaceBodySchema,
  workspaceResponseSchema,
  workspaceSlugAvailabilityResponseSchema,
} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  listUserWorkspaces,
  userWorkspacesQueryKey,
  userWorkspacesQueryOptions,
} from '@shipfox/client-shell/runtime';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {useSetAtom} from 'jotai';
import type {WorkspaceCreateCommand, WorkspaceUpdateCommand} from '#core/auth.js';
import {authStateAtom} from '#state/auth.js';
import {useRefreshAuth} from './refresh-auth.js';
import {toWorkspace} from './workspace-mapper.js';

export async function createWorkspace(command: WorkspaceCreateCommand) {
  const response = await checkedApiRequest(workspaceResponseSchema, '/workspaces', {
    method: 'POST',
    body: {name: command.name, slug: command.slug},
  });
  return toWorkspace(response);
}

export async function updateWorkspace(command: WorkspaceUpdateCommand) {
  const body = updateWorkspaceBodySchema.parse({name: command.name, slug: command.slug});
  const response = await checkedApiRequest(
    workspaceResponseSchema,
    `/workspaces/${command.workspaceId}`,
    {method: 'PATCH', body},
  );
  return toWorkspace(response);
}

export async function checkWorkspaceSlugAvailability(slug: string): Promise<boolean> {
  const response = await checkedApiRequest(
    workspaceSlugAvailabilityResponseSchema,
    `/workspaces/slug-availability?slug=${encodeURIComponent(slug)}`,
  );
  return response.available;
}

export {listUserWorkspaces, userWorkspacesQueryKey, userWorkspacesQueryOptions};

export function useCreateWorkspaceAuth() {
  const refreshAuth = useRefreshAuth();

  return useMutation({
    mutationFn: createWorkspace,
    onSuccess: async () => {
      // The new workspace introduces a membership the existing access token
      // doesn't carry. Refresh so the next request includes it in the JWT
      // claim and passes the in-memory canAccess() check on the server.
      await refreshAuth();
    },
  });
}

export function useUpdateWorkspaceMutation() {
  const queryClient = useQueryClient();
  const setAuthState = useSetAtom(authStateAtom);

  return useMutation({
    mutationFn: updateWorkspace,
    onSuccess: async (workspace) => {
      setAuthState((previous) => {
        if (previous.status !== 'authenticated') return previous;
        return {
          ...previous,
          workspaces: (previous.workspaces ?? []).map((candidate) =>
            candidate.id === workspace.id
              ? {...candidate, name: workspace.name, slug: workspace.slug, status: workspace.status}
              : candidate,
          ),
        };
      });
      await queryClient.invalidateQueries({queryKey: userWorkspacesQueryKey});
    },
  });
}
