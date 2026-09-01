import {ButtonLink} from '@shipfox/react-ui/button';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {SetupChecklistItem} from '#core/setup-checklist.js';
import {ChecklistStatus, checklistActionTarget} from './setup-checklist-item-primitives.js';

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

  return (
    <li className="flex min-w-0 items-start gap-group border-b border-border-neutral-base px-row py-row last:border-b-0">
      <ChecklistStatus item={item} />
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
            <ButtonLink
              asChild
              variant={pointer ? 'muted' : 'interactive'}
              underline
              iconRight="chevronRight"
            >
              {checklistActionTarget({
                action: item.action,
                workspaceSlug,
                onClick: () => onAction?.(item),
              })}
            </ButtonLink>
          </div>
        ) : null}
      </div>
    </li>
  );
}
