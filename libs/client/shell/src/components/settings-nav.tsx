import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
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
      className="flex flex-col gap-tight"
    >
      {scopedEntries.map((entry) => {
        const to = `${settingsPath}/${entry.pathSegment}`;
        const active = Boolean(matchRoute({to: to as never, params: paramsForLink as never}));
        return (
          <Button
            key={entry.id}
            asChild
            variant={active ? 'secondary' : 'transparent'}
            className="w-full justify-start"
          >
            <Link
              to={to as never}
              params={paramsForLink as never}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={entry.icon} className="size-16" />
              {entry.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
