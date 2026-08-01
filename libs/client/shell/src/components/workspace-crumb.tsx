import {Icon} from '@shipfox/react-ui/icon';
import {Popover, PopoverContent, PopoverTrigger} from '@shipfox/react-ui/popover';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import type {Workspace} from '#runtime/auth.js';
import {WorkspaceSwitcher} from './workspace-switcher.js';

export interface WorkspaceCrumbProps {
  workspace: Workspace;
  compact?: boolean;
}

export function WorkspaceCrumb({workspace, compact = false}: WorkspaceCrumbProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center">
      <Link
        to="/w/$workspaceSlug"
        params={{workspaceSlug: workspace.slug}}
        aria-current="page"
        className={`inline-block text-md font-medium text-foreground-neutral-base px-6 py-4 rounded-6 hover:bg-background-components-hover transition-colors truncate ${compact ? 'max-w-[120px] sm:max-w-[200px]' : 'max-w-[200px]'}`}
      >
        {workspace.name}
      </Link>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Switch workspace"
            aria-haspopup="listbox"
            aria-expanded={open}
            className="ml-2 grid place-items-center size-24 rounded-4 text-foreground-neutral-muted hover:bg-background-components-hover hover:text-foreground-neutral-base transition-colors"
          >
            <Icon name="arrowDownSLine" className="size-16" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start" sideOffset={8}>
          <WorkspaceSwitcher activeWorkspaceId={workspace.id} onSelect={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
