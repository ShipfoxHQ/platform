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
import {type KeyboardEvent, useEffect, useState} from 'react';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export interface ProjectSwitcherProps {
  workspaceId: string;
  workspaceSlug: string;
  activeProjectId?: string | undefined;
  onSelect?: () => void;
}

export function ProjectSwitcher({
  workspaceId,
  workspaceSlug,
  activeProjectId,
  onSelect,
}: ProjectSwitcherProps) {
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const query = useProjectsInfiniteQuery(workspaceId);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];

  // Eagerly fetch additional pages once the popover opens; the switcher should
  // show the full list, not just the first page.
  useEffect(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  }, [query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  const handleSelect = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    navigate({
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: {
        workspaceSlug,
        projectSlug: project.slug,
      },
    });
    onSelect?.();
  };

  const handleSelectAll = () => {
    navigate({to: '/w/$workspaceSlug', params: {workspaceSlug}});
    onSelect?.();
  };

  const handleCreate = () => {
    navigate({to: '/w/$workspaceSlug/projects/new', params: {workspaceSlug}});
    onSelect?.();
  };

  const normalizedSearch = searchValue.trim().toLowerCase();
  const hasSearchMatch =
    normalizedSearch.length === 0 ||
    'all projects'.includes(normalizedSearch) ||
    projects.some((project) =>
      [project.id, project.name].some((value) => value.toLowerCase().includes(normalizedSearch)),
    );
  const shouldCreateFromEmptySearch = !query.isLoading && !query.isError && !hasSearchMatch;

  const handleCommandKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || !shouldCreateFromEmptySearch) {
      return;
    }

    event.preventDefault();
    handleCreate();
  };

  let emptyMessage = 'No projects found.';
  if (query.isError) emptyMessage = "Couldn't load projects.";
  else if (query.isLoading) emptyMessage = 'Loading projects...';
  else if (projects.length === 0) emptyMessage = 'No projects yet.';

  return (
    <Command onKeyDown={handleCommandKeyDown}>
      <CommandInput
        placeholder="Search projects..."
        value={searchValue}
        onValueChange={setSearchValue}
      />
      <CommandList>
        <CommandEmpty>{emptyMessage}</CommandEmpty>
        <CommandGroup>
          <CommandItem value="__all" keywords={['all projects']} onSelect={handleSelectAll}>
            <Icon
              name="check"
              className={`size-16 ${activeProjectId ? 'opacity-0' : 'opacity-100'}`}
            />
            All projects
          </CommandItem>
        </CommandGroup>
        {projects.length > 0 ? (
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={project.id}
                keywords={[project.name]}
                onSelect={() => handleSelect(project.id)}
              >
                <Icon
                  name="check"
                  className={`size-16 ${
                    activeProjectId === project.id ? 'opacity-100' : 'opacity-0'
                  }`}
                />
                {project.name}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      <CommandSeparator />
      <CommandGroup forceMount>
        <CommandItem value="__create" onSelect={handleCreate} forceMount>
          <Icon name="addLine" className="size-16" />
          Create project
        </CommandItem>
      </CommandGroup>
    </Command>
  );
}
