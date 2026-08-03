import {listUserWorkspaces, userWorkspacesQueryKey} from '@shipfox/client-shell/runtime';
import type {QueryClient} from '@tanstack/react-query';

interface WorkspaceSlugCandidate {
  id: string;
  slug: string;
}

interface UserWorkspacesQueryData {
  memberships: WorkspaceSlugCandidate[];
}

export function rememberCallbackKey(keys: Set<string>, key: string, maxSize = 32): void {
  keys.delete(key);
  keys.add(key);
  if (keys.size <= maxSize) return;
  const oldest = keys.values().next().value;
  if (typeof oldest === 'string') keys.delete(oldest);
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
