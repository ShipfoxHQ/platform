import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@shipfox/react-ui/command';
import {Icon} from '@shipfox/react-ui/icon';
import {useNavigate} from '@tanstack/react-router';
import {useSetAtom} from 'jotai';
import {useAuthState} from '#runtime/auth.js';
import {lastWorkspaceIdAtom, rememberLastWorkspaceId} from '#runtime/last-workspace.js';

export function WorkspaceSwitcher({
  activeWorkspaceId,
  onSelect,
}: {
  activeWorkspaceId?: string;
  onSelect?: () => void;
}) {
  const {user, workspaces} = useAuthState();
  const navigate = useNavigate();
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);
  const selectWorkspace = (wid: string) => {
    try {
      setLastWorkspaceId(wid);
      if (user?.id) rememberLastWorkspaceId(user.id, wid);
    } catch {
      // Local storage is best effort.
    }
    const workspace = workspaces.find((candidate) => candidate.id === wid);
    if (!workspace) return;
    navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: workspace.slug}});
    onSelect?.();
  };
  return (
    <Command>
      <CommandInput placeholder="Search workspaces..." />
      <CommandList className="max-h-none overflow-visible overflow-y-visible p-0">
        <div className="max-h-300 overflow-y-auto overflow-x-hidden p-4 scrollbar">
          <CommandEmpty>No workspaces found.</CommandEmpty>
          <CommandGroup heading="Workspaces">
            {workspaces.map((workspace) => (
              <CommandItem
                key={workspace.id}
                value={workspace.id}
                keywords={[workspace.name]}
                onSelect={() => selectWorkspace(workspace.id)}
              >
                <Icon
                  name="check"
                  className={`size-16 mr-8 ${activeWorkspaceId === workspace.id ? 'opacity-100' : 'opacity-0'}`}
                />
                {workspace.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </div>
        <CommandSeparator alwaysRender className="mx-0" />
        <CommandGroup forceMount className="p-4">
          <CommandItem
            value="__create"
            onSelect={() => {
              navigate({to: '/setup/workspaces/new' as never});
              onSelect?.();
            }}
            forceMount
          >
            <Icon name="addLine" className="size-16" />
            Create workspace
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
