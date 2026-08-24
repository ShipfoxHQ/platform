import {ButtonLink} from '@shipfox/react-ui/button';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import type {SetupChecklistItem} from '#core/setup-checklist.js';

export function ChecklistRow({
  item,
  workspaceSlug,
  onAction,
}: {
  item: SetupChecklistItem;
  workspaceSlug: string;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
}) {
  const pointer = !item.tracked;
  const showDetails = pointer || item.status === 'open';
  const statusLabel =
    item.status === 'done'
      ? 'done'
      : pointer
        ? 'next step'
        : item.attention
          ? 'needs attention'
          : 'to do';

  return (
    <li className="flex min-w-0 items-start gap-group border-b border-border-neutral-base px-row py-row last:border-b-0">
      <ChecklistStatus item={item} pointer={pointer} label={statusLabel} />
      <div className="min-w-0 flex-1">
        <Text
          as="span"
          size="sm"
          className={cn(
            'block',
            item.status === 'done' && !pointer
              ? 'text-foreground-neutral-muted'
              : 'text-foreground-neutral-base',
          )}
        >
          {item.title}
        </Text>
        {showDetails && item.purpose ? (
          <Text as="span" size="xs" className="mt-tight block text-foreground-neutral-muted">
            {item.purpose}
          </Text>
        ) : null}
        {showDetails && item.action ? (
          <div className="mt-inline">
            <ChecklistActionLink
              item={item}
              action={item.action}
              pointer={pointer}
              workspaceSlug={workspaceSlug}
              onAction={onAction}
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ChecklistStatus({
  item,
  pointer,
  label,
}: {
  item: SetupChecklistItem;
  pointer: boolean;
  label: string;
}) {
  if (pointer) {
    return (
      <span className="mt-1 shrink-0">
        <Icon
          name={item.status === 'done' ? 'checkCircleSolid' : 'circleDottedLine'}
          className={cn(
            'size-16',
            item.status === 'done'
              ? 'text-foreground-highlight-interactive'
              : 'text-foreground-neutral-subtle',
          )}
          aria-hidden="true"
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  if (item.status === 'done') {
    return (
      <span className="mt-1 shrink-0">
        <Icon
          name="checkCircleSolid"
          className="size-16 text-foreground-highlight-interactive"
          aria-hidden="true"
        />
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className="mt-1 shrink-0">
      <span
        aria-hidden="true"
        className="block size-16 rounded-full border-2 border-foreground-neutral-subtle"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ChecklistActionLink({
  item,
  action,
  pointer,
  workspaceSlug,
  onAction,
}: {
  item: SetupChecklistItem;
  action: NonNullable<SetupChecklistItem['action']>;
  pointer: boolean;
  workspaceSlug: string;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
}) {
  const handleClick = () => onAction?.(item);
  const variant = pointer ? 'muted' : 'interactive';

  if (action.href === '/docs/getting-started') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <a href={action.href} onClick={handleClick}>
          {action.label}
        </a>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/integrations') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link
          to="/w/$workspaceSlug/settings/integrations"
          params={{workspaceSlug}}
          onClick={handleClick}
        >
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/runners') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link
          to="/w/$workspaceSlug/settings/runners"
          params={{workspaceSlug}}
          onClick={handleClick}
        >
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  if (action.href === '/settings/agents') {
    return (
      <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
        <Link to="/w/$workspaceSlug/settings/agents" params={{workspaceSlug}} onClick={handleClick}>
          {action.label}
        </Link>
      </ButtonLink>
    );
  }

  return (
    <ButtonLink asChild variant={variant} underline iconRight="chevronRight">
      <Link to="/w/$workspaceSlug/settings/members" params={{workspaceSlug}} onClick={handleClick}>
        {action.label}
      </Link>
    </ButtonLink>
  );
}
