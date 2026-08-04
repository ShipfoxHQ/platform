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
import {useAuthState} from '#hooks/use-auth-state.js';
import {lastWorkspaceIdAtom, rememberLastWorkspaceId} from '#state/last-workspace.js';

export interface WorkspaceSwitcherProps {
  activeWorkspaceId: string | undefined;
  onSelect?: () => void;
}

export function WorkspaceSwitcher({activeWorkspaceId, onSelect}: WorkspaceSwitcherProps) {
  const {user, workspaces} = useAuthState();
  const navigate = useNavigate();
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);

  const handleSelect = (workspaceId: string) => {
    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace) return;
    try {
      setLastWorkspaceId(workspaceId);
      if (user?.id) rememberLastWorkspaceId(user.id, workspaceId);
    } catch {
      // localStorage may throw in private browsing or quota-exceeded; persistence is best-effort.
    }
    navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: workspace.slug}});
    onSelect?.();
  };

  const handleCreate = () => {
    navigate({to: '/setup/workspaces/new'});
    onSelect?.();
  };

  return (
    <Command>
      <CommandInput placeholder="Search workspaces..." />
      <CommandList className="max-h-none overflow-visible overflow-y-visible p-0">
        <div className="max-h-300 overflow-y-auto overflow-x-hidden p-[4px] scrollbar">
          <CommandEmpty>No workspaces found.</CommandEmpty>
          <CommandGroup heading="Workspaces">
            {workspaces.map((workspace) => (
              <CommandItem
                key={workspace.id}
                value={workspace.id}
                keywords={[workspace.name]}
                onSelect={() => handleSelect(workspace.id)}
              >
                <Icon
                  name="check"
                  className={`size-16 ${
                    activeWorkspaceId === workspace.id ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                {workspace.name}
              </CommandItem>
            ))}
          </CommandGroup>
        </div>
        <CommandSeparator alwaysRender className="mx-0" />
        <CommandGroup forceMount className="p-[4px]">
          <CommandItem value="__create" onSelect={handleCreate} forceMount>
            <Icon name="addLine" className="size-16" />
            Create workspace
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
