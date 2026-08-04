import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {TableCell, TableRow} from '@shipfox/react-ui/table';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import type {MouseEvent} from 'react';
import type {TriggerEventSummary} from '#core/trigger-event.js';
import {triggerEventResult} from './trigger-event-result.js';
import {TriggerSourceIcon} from './trigger-source-icon.js';

interface TriggerEventRowProps {
  event: TriggerEventSummary;
  selected: boolean;
  onSelect: (eventId: string) => void;
}

export function TriggerEventRow({event, selected, onSelect}: TriggerEventRowProps) {
  const result = triggerEventResult(event);
  const eventLabel = triggerEventDisplayLabel(event);
  const fullEventLabel = triggerEventFullLabel(event);

  function handleRowClick(clickEvent: MouseEvent<HTMLTableRowElement>) {
    const target = clickEvent.target;
    if (target instanceof HTMLElement && target.closest('button,a')) return;
    onSelect(event.id);
  }

  return (
    <TableRow
      data-selected={selected ? 'true' : undefined}
      className="cursor-pointer"
      onClick={handleRowClick}
    >
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 items-center gap-inline rounded-6 text-left outline-none focus-visible:shadow-button-neutral-focus"
              onClick={() => onSelect(event.id)}
              aria-label={`Open details for ${fullEventLabel}`}
            >
              <TriggerSourceIcon
                provider={event.provider}
                source={event.source}
                aria-hidden="true"
                className="size-16 shrink-0 text-foreground-neutral-muted"
              />
              <Code as="span" variant="label" className="truncate text-foreground-neutral-base">
                {eventLabel}
              </Code>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <Code as="span" variant="label" className="block max-w-[360px] break-words">
              {fullEventLabel}
            </Code>
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Text
          size="sm"
          className={cn(
            result.isFailure ? 'text-foreground-highlight-error' : 'text-foreground-neutral-subtle',
          )}
        >
          {result.label}
        </Text>
      </TableCell>
      <TableCell className="text-right">
        <Code as="span" variant="label" className="text-foreground-neutral-muted">
          <RelativeTime value={event.receivedAt} />
        </Code>
      </TableCell>
    </TableRow>
  );
}

function triggerEventDisplayLabel(event: Pick<TriggerEventSummary, 'event' | 'source'>) {
  return event.event || event.source;
}

function triggerEventFullLabel(event: Pick<TriggerEventSummary, 'event' | 'source'>) {
  return [event.source, event.event].filter(Boolean).join(' · ');
}
