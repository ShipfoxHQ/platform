import {Link} from '@tanstack/react-router';
import {useReducedMotion} from 'framer-motion';
import type {NavTabEntry} from '#contract.js';
import {parseWorkspaceProjectParams, useRouteParams} from '#runtime/route-inputs.js';

export function NavTabs({
  entries,
  scope,
}: {
  entries: readonly NavTabEntry[];
  scope: NavTabEntry['scope'];
}) {
  const params = useRouteParams(parseWorkspaceProjectParams);
  const reduced = useReducedMotion();
  const tabs = entries.filter((entry) => entry.scope === scope);
  const projectScoped = scope === 'project';
  const tabClassName = `h-40 inline-flex shrink-0 items-center whitespace-nowrap px-tight ${projectScoped ? 'text-xs' : 'text-sm'} font-medium transition-colors ${reduced ? '' : 'transition-[border-color]'}`;
  const activeProps = {
    className: projectScoped
      ? 'border-b border-border-highlights-interactive text-foreground-neutral-base'
      : 'border-b-2 border-border-highlights-interactive text-foreground-neutral-base',
    'aria-selected': 'true' as const,
  };
  const inactiveProps = {
    className: `${projectScoped ? 'border-b' : 'border-b-2'} border-transparent text-foreground-neutral-subtle hover:text-foreground-neutral-base`,
    'aria-selected': 'false' as const,
  };

  return (
    <div
      role="tablist"
      aria-label={`${scope === 'project' ? 'Project' : 'Workspace'} sections`}
      className="sticky top-56 z-20 flex h-40 items-end gap-cluster overflow-x-auto whitespace-nowrap border-b border-border-neutral-base bg-background-subtle-base px-row [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((entry) => (
        <Link
          key={entry.id}
          to={entry.to as never}
          params={params as never}
          role="tab"
          activeOptions={{exact: entry.exact ?? false}}
          activeProps={activeProps}
          inactiveProps={inactiveProps}
          className={tabClassName}
        >
          {entry.label}
        </Link>
      ))}
    </div>
  );
}
