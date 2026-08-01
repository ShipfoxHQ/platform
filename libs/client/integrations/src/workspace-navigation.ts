import {listUserWorkspaces, userWorkspacesQueryKey} from '@shipfox/client-shell/runtime';
import type {QueryClient} from '@tanstack/react-query';

interface WorkspaceSlugCandidate {
  id: string;
  slug: string;
}

interface UserWorkspacesQueryData {
  memberships: WorkspaceSlugCandidate[];
}

export async function resolveWorkspaceSlug({
  workspaceId,
  fallbackWorkspaces,
  queryClient,
}: {
  workspaceId: string;
  fallbackWorkspaces: readonly WorkspaceSlugCandidate[];
  queryClient: QueryClient;
}): Promise<string | undefined> {
  const currentWorkspaces = await listUserWorkspaces()
    .then(({memberships}) => memberships)
    .catch(() => {
      const refreshedWorkspaces =
        queryClient.getQueryData<UserWorkspacesQueryData>(userWorkspacesQueryKey);
      return refreshedWorkspaces?.memberships ?? fallbackWorkspaces;
    });
  return currentWorkspaces.find(({id}) => id === workspaceId)?.slug;
}
