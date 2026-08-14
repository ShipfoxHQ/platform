import {IntegrationIcon} from '@shipfox/integration-icons';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import type {IntegrationConnection} from '#core/models.js';

export function ConnectionPicker({
  connections,
  selectedConnectionId,
  onSelect,
}: {
  connections: IntegrationConnection[];
  selectedConnectionId: string | undefined;
  onSelect: (connectionId: string) => void;
}) {
  const labelId = useId();

  return (
    <div className="flex min-w-0 flex-col">
      <Label id={labelId} className="sr-only">
        Source integration
      </Label>
      <RadioGroup
        variant="cell"
        aria-labelledby={labelId}
        value={selectedConnectionId ?? ''}
        onValueChange={onSelect}
      >
        {connections.map((connection) => (
          <RadioGroupItem key={connection.id} value={connection.id}>
            <ConnectionOption connection={connection} />
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  );
}

function ConnectionOption({connection}: {connection: IntegrationConnection}) {
  const {ref: nameRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(connection.displayName);

  return (
    <span className="flex min-w-0 items-center gap-inline">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0">
            <IntegrationIcon
              source={connection.provider}
              aria-hidden
              className="size-20 text-foreground-neutral-base"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{integrationName(connection.provider)}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span ref={nameRef} className="min-w-0 truncate">
            <Text as="span" size="sm" bold>
              {connection.displayName}
            </Text>
          </span>
        </TooltipTrigger>
        {isTruncated ? <TooltipContent>{connection.displayName}</TooltipContent> : null}
      </Tooltip>
    </span>
  );
}

function integrationName(provider: string): string {
  switch (provider) {
    case 'github':
      return 'GitHub';
    case 'gitea':
      return 'Gitea';
    case 'sentry':
      return 'Sentry';
    case 'webhook':
      return 'Webhook';
    case 'debug':
      return 'Debug';
    default:
      return provider;
  }
}
