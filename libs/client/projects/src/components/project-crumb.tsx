import {Icon} from '@shipfox/react-ui/icon';
import {Popover, PopoverContent, PopoverTrigger} from '@shipfox/react-ui/popover';
import {Link} from '@tanstack/react-router';
import {useState} from 'react';
import {ProjectSwitcher} from './project-switcher.js';

export interface ProjectCrumbProps {
  workspaceId: string;
  workspaceSlug: string;
  projectId?: string | undefined;
  projectSlug?: string | undefined;
  projectName?: string | undefined;
}

export function ProjectCrumb({
  workspaceId,
  workspaceSlug,
  projectId,
  projectSlug,
  projectName,
}: ProjectCrumbProps) {
  const [open, setOpen] = useState(false);

  if (projectSlug && projectName) {
    return (
      <div className="flex items-center gap-tight">
        <Link
          to="/w/$workspaceSlug/p/$projectSlug"
          params={{workspaceSlug, projectSlug}}
          aria-current="page"
          className="text-md font-medium text-foreground-neutral-base p-tight rounded-6 hover:bg-background-components-hover transition-colors max-w-[240px] truncate"
        >
          {projectName}
        </Link>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Switch project"
              aria-haspopup="listbox"
              aria-expanded={open}
              className="grid place-items-center size-24 rounded-4 text-foreground-neutral-muted hover:bg-background-components-hover hover:text-foreground-neutral-base transition-colors"
            >
              <Icon name="arrowDownSLine" className="size-16" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start" sideOffset={8}>
            <ProjectSwitcher
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              activeProjectId={projectId}
              onSelect={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch project"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-tight text-md font-medium text-foreground-neutral-base p-tight rounded-6 hover:bg-background-components-hover transition-colors"
        >
          <span className="max-w-[240px] truncate">All projects</span>
          <Icon name="arrowDownSLine" className="size-16 text-foreground-neutral-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start" sideOffset={8}>
        <ProjectSwitcher
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onSelect={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
