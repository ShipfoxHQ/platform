import {Icon} from '@shipfox/react-ui/icon';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import type {ReactElement} from 'react';
import type {SetupChecklistAction, SetupChecklistItem} from '#core/setup-checklist.js';

const GETTING_STARTED_URL = 'https://www.shipfox.io/docs/getting-started';

export function checklistStatusLabel(item: SetupChecklistItem): string {
  if (item.status === 'done') return 'done';
  if (!item.tracked) return 'next step';
  return item.attention ? 'needs attention' : 'to do';
}

export function ChecklistStatus({item}: {item: SetupChecklistItem}) {
  const done = item.status === 'done';
  const pointer = !item.tracked;

  return (
    <span className="mt-1 shrink-0">
      {done || pointer ? (
        <Icon
          name={done ? 'checkCircleSolid' : 'circleDottedLine'}
          className={cn(
            'size-16',
            done ? 'text-foreground-highlight-interactive' : 'text-foreground-neutral-subtle',
          )}
          aria-hidden="true"
        />
      ) : (
        <span
          aria-hidden="true"
          className="block size-16 rounded-full border-2 border-foreground-neutral-subtle"
        />
      )}
      <span className="sr-only">{checklistStatusLabel(item)}</span>
    </span>
  );
}

/**
 * The anchor for a checklist action, ready to be slotted into a `Button` or a
 * `ButtonLink`. Each route is written out because the router types `params`
 * against a literal `to`, so a computed path loses its inference. The switch is
 * exhaustive over `SetupChecklistActionHref`, so a new destination fails to
 * compile rather than silently routing to the last branch.
 */
export function checklistActionTarget({
  action,
  workspaceSlug,
  onClick,
}: {
  action: SetupChecklistAction;
  workspaceSlug: string;
  onClick: () => void;
}): ReactElement {
  switch (action.href) {
    case '/docs/getting-started':
      return (
        <a href={GETTING_STARTED_URL} onClick={onClick}>
          {action.label}
        </a>
      );
    case '/settings/integrations':
      return (
        <Link
          to="/w/$workspaceSlug/settings/integrations"
          params={{workspaceSlug}}
          onClick={onClick}
        >
          {action.label}
        </Link>
      );
    case '/settings/runners':
      return (
        <Link to="/w/$workspaceSlug/settings/runners" params={{workspaceSlug}} onClick={onClick}>
          {action.label}
        </Link>
      );
    case '/settings/agents':
      return (
        <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug}} onClick={onClick}>
          {action.label}
        </Link>
      );
    case '/settings/members':
      return (
        <Link to="/w/$workspaceSlug/settings/members" params={{workspaceSlug}} onClick={onClick}>
          {action.label}
        </Link>
      );
  }
}
