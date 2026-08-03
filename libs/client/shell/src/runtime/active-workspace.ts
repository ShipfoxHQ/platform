import {useAuthState, type Workspace} from './auth.js';
import {parseWorkspaceParams, useRouteParams} from './route-inputs.js';

export function useActiveWorkspace(): Workspace {
  const workspace = useMaybeActiveWorkspace();
  if (!workspace) throw new Error('useActiveWorkspace called outside a /w/$workspaceSlug route');
  return workspace;
}

export function useMaybeActiveWorkspace(): Workspace | undefined {
  const {workspaceSlug} = useRouteParams(parseWorkspaceParams);
  return useAuthState().workspaces.find((workspace) => workspace.slug === workspaceSlug);
}
