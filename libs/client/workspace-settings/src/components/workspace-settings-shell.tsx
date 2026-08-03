import {useMaybeActiveWorkspace} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import type {ReactNode} from 'react';

interface WorkspaceSettingsShellProps {
  children: (workspace: NonNullable<ReturnType<typeof useMaybeActiveWorkspace>>) => ReactNode;
}

export function WorkspaceSettingsShell({children}: WorkspaceSettingsShellProps) {
  const workspace = useMaybeActiveWorkspace();
  if (!workspace) return <FullPageLoader />;

  return children(workspace);
}
