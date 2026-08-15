import {Icon} from '@shipfox/react-ui/icon';
import {cn} from '@shipfox/react-ui/utils';
import {Link, useMatchRoute} from '@tanstack/react-router';
import type {SettingsSectionEntry} from '#contract.js';
import {
  parseWorkspaceParams,
  parseWorkspaceProjectParams,
  useRouteParams,
} from '#runtime/route-inputs.js';

export function SettingsNav({
  entries,
  scope,
}: {
  entries: readonly SettingsSectionEntry[];
  scope: 'workspace' | 'project';
}) {
  const params = useRouteParams((input): {workspaceSlug?: string; projectSlug?: string} =>
    scope === 'workspace' ? parseWorkspaceParams(input) : parseWorkspaceProjectParams(input),
  );
  const matchRoute = useMatchRoute();
  if (!params.workspaceSlug || (scope === 'project' && !params.projectSlug)) return null;
  const scopedEntries = entries.filter((entry) => (entry.scope ?? 'workspace') === scope);
  const settingsPath =
    scope === 'workspace'
      ? '/w/$workspaceSlug/settings'
      : '/w/$workspaceSlug/p/$projectSlug/settings';
  const paramsForLink =
    scope === 'workspace'
      ? {workspaceSlug: params.workspaceSlug}
      : {workspaceSlug: params.workspaceSlug, projectSlug: params.projectSlug};

  return (
    <nav
      aria-label={`${scope === 'workspace' ? 'Workspace' : 'Project'} settings`}
      className="flex min-w-0 flex-col"
    >
      <ul className="divide-y divide-border-neutral-base">
        {scopedEntries.map((entry) => {
          const to = `${settingsPath}/${entry.pathSegment}`;
          const active = Boolean(matchRoute({to: to as never, params: paramsForLink as never}));
          return (
            <li key={entry.id} className="py-tight first:pt-0 last:pb-0">
              <Link
                to={to as never}
                params={paramsForLink as never}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-32 w-full items-center justify-start gap-inline rounded-4 px-tight text-left text-sm font-medium text-foreground-neutral-base outline-none transition-colors hover:bg-background-neutral-hover focus-visible:shadow-border-interactive-with-active',
                  active && 'bg-background-neutral-hover',
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    data-settings-active-bar
                    className="absolute inset-y-0 left-0 w-2 rounded-l-4 bg-border-highlights-interactive"
                  />
                ) : null}
                <Icon name={entry.icon} className="size-16" aria-hidden="true" />
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
