import {Button} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Link, useMatchRoute} from '@tanstack/react-router';
import type {SettingsSectionEntry} from '#contract.js';
import {parseWorkspaceParams, useRouteParams} from '#runtime/route-inputs.js';

export function SettingsNav({entries}: {entries: readonly SettingsSectionEntry[]}) {
  const params = useRouteParams(parseWorkspaceParams);
  const matchRoute = useMatchRoute();
  if (!params.workspaceSlug) return null;
  return (
    <nav aria-label="Workspace settings" className="flex flex-col gap-4">
      {entries.map((entry) => {
        const to = `/w/$workspaceSlug/settings/${entry.pathSegment}`;
        const active = Boolean(
          matchRoute({to: to as never, params: {workspaceSlug: params.workspaceSlug} as never}),
        );
        return (
          <Button
            key={entry.id}
            asChild
            variant={active ? 'secondary' : 'transparent'}
            className="w-full justify-start"
          >
            <Link
              to={to as never}
              params={{workspaceSlug: params.workspaceSlug} as never}
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
