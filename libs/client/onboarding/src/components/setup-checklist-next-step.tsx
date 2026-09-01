import {Button} from '@shipfox/react-ui/button';
import {Text} from '@shipfox/react-ui/typography';
import type {SetupChecklistItem} from '#core/setup-checklist.js';
import {ChecklistStatus, checklistActionTarget} from './setup-checklist-item-primitives.js';

/**
 * The collapsed panel body: one step at full weight. A pointer keeps the
 * secondary fill, because reading the quickstart is an offer rather than the
 * workspace's next unfinished ask.
 */
export function SetupChecklistNextStep({
  item,
  workspaceSlug,
  onAction,
}: {
  item: SetupChecklistItem;
  workspaceSlug: string;
  onAction?: ((item: SetupChecklistItem) => void) | undefined;
}) {
  return (
    <div className="flex min-w-0 items-start gap-group px-row py-row">
      <ChecklistStatus item={item} />
      <div className="min-w-0 flex-1">
        <Text as="span" size="sm" className="block text-foreground-neutral-base">
          {item.title}
        </Text>
        {item.purpose ? (
          <Text as="span" size="xs" className="mt-tight block text-foreground-neutral-muted">
            {item.purpose}
          </Text>
        ) : null}
      </div>
      {item.action ? (
        <Button
          asChild
          size="sm"
          variant={item.tracked ? 'primary' : 'secondary'}
          className="self-center"
        >
          {checklistActionTarget({
            action: item.action,
            workspaceSlug,
            onClick: () => onAction?.(item),
          })}
        </Button>
      ) : null}
    </div>
  );
}
