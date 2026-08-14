import {Button} from '@shipfox/react-ui/button';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Label} from '@shipfox/react-ui/label';
import {PanelGrid} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem, RadioGroupItemSkeleton} from '@shipfox/react-ui/radio-group';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import type {Repository} from '#core/models.js';

const REPOSITORY_SKELETON_WIDTHS = ['w-64', 'w-96', 'w-80', 'w-112'] as const;

export function RepositoryPicker({
  repositories,
  selectedRepositoryId,
  onSelect,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  emptyMessage = 'No repositories found.',
}: {
  repositories: Repository[];
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
}) {
  const labelId = useId();

  return (
    <div className="flex min-w-0 flex-col">
      <Label id={labelId} className="sr-only">
        Repository
      </Label>

      {isLoading ? <RepositoryLoadingState /> : null}

      {!isLoading && repositories.length === 0 ? (
        <Text size="sm" className="px-row py-row">
          {emptyMessage}
        </Text>
      ) : null}

      {repositories.length > 0 ? (
        <RadioGroup
          variant="cell"
          aria-labelledby={labelId}
          value={selectedRepositoryId ?? ''}
          onValueChange={onSelect}
        >
          {repositories.map((repository) => (
            <RepositoryCard key={repository.externalRepositoryId} repository={repository} />
          ))}
        </RadioGroup>
      ) : null}

      {hasNextPage && onLoadMore ? (
        <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isFetchingNextPage ?? false}
            onClick={onLoadMore}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RepositoryCard({repository}: {repository: Repository}) {
  const {ref: nameRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(repository.name);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RadioGroupItem value={repository.externalRepositoryId}>
          <span ref={nameRef} className="block min-w-0 truncate">
            <Text as="span" size="sm" bold>
              {repository.name}
            </Text>
          </span>
        </RadioGroupItem>
      </TooltipTrigger>
      {isTruncated ? <TooltipContent>{repository.name}</TooltipContent> : null}
    </Tooltip>
  );
}

function RepositoryLoadingState() {
  return (
    <>
      <div role="status" className="sr-only">
        Loading repositories.
      </div>
      <PanelGrid as="div" aria-hidden="true">
        {REPOSITORY_SKELETON_WIDTHS.map((width) => (
          <RadioGroupItemSkeleton key={width} variant="cell" labelClassName={width} />
        ))}
      </PanelGrid>
    </>
  );
}
