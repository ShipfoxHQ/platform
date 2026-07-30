import {workspaceResponseSchema} from '@shipfox/api-workspaces-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  listUserWorkspaces,
  userWorkspacesQueryKey,
  userWorkspacesQueryOptions,
} from '@shipfox/client-shell/runtime';
import {useMutation} from '@tanstack/react-query';
import type {WorkspaceCreateCommand} from '#core/auth.js';
import {useRefreshAuth} from './refresh-auth.js';
import {toWorkspace} from './workspace-mapper.js';

export async function createWorkspace(command: WorkspaceCreateCommand) {
  const response = await checkedApiRequest(workspaceResponseSchema, '/workspaces', {
    method: 'POST',
    body: {name: command.name, slug: command.slug},
  });
  return toWorkspace(response);
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
