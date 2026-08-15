import {
  useAuthState,
  useMaybeActiveWorkspace,
  WorkspaceUnavailablePage,
} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Navigate} from '@tanstack/react-router';
import type {ReactNode} from 'react';

interface WorkspaceSettingsShellProps {
  children: (workspace: NonNullable<ReturnType<typeof useMaybeActiveWorkspace>>) => ReactNode;
}

export function WorkspaceSettingsShell({children}: WorkspaceSettingsShellProps) {
  const auth = useAuthState();
  const workspace = useMaybeActiveWorkspace();
  if (auth.isLoading) return <FullPageLoader />;
  if (!auth.isAuthenticated) return <Navigate to={'/auth/login' as never} replace />;
  if (!workspace) return <WorkspaceUnavailablePage />;

  return children(workspace);
}
