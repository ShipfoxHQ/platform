import {Button} from '@shipfox/react-ui/button';
import {useIsTextTruncated} from '@shipfox/react-ui/hooks';
import {Input} from '@shipfox/react-ui/input';
import {Label} from '@shipfox/react-ui/label';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import {useId} from 'react';
import type {Repository} from '#core/models.js';

const REPOSITORY_GRID_CLASS_NAME = 'grid grid-cols-2 gap-inline max-[760px]:grid-cols-1';
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
  searchValue,
  onSearchChange,
  searchDisabled,
}: {
  repositories: Repository[];
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  isLoading: boolean;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  onLoadMore?: () => void;
  emptyMessage?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchDisabled?: boolean;
}) {
  const labelId = useId();
  const showSearch = onSearchChange !== undefined;

  return (
    <div className="flex flex-col gap-inline">
      <Label id={labelId} className="sr-only">
        Repository
      </Label>

      {showSearch ? (
        <Input
          type="search"
          placeholder="Search repositories…"
          aria-label="Search repositories"
          value={searchValue ?? ''}
          onChange={(event) => onSearchChange?.(event.target.value)}
          disabled={searchDisabled}
        />
      ) : null}

      {isLoading ? <RepositoryLoadingState /> : null}

      {!isLoading && repositories.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact">
          <Text size="sm">{emptyMessage}</Text>
        </div>
      ) : null}

      {repositories.length > 0 ? (
        <RadioGroup
          aria-labelledby={labelId}
          value={selectedRepositoryId ?? ''}
          onValueChange={onSelect}
          className={REPOSITORY_GRID_CLASS_NAME}
        >
          {repositories.map((repository) => (
            <RepositoryCard key={repository.externalRepositoryId} repository={repository} />
          ))}
        </RadioGroup>
      ) : null}

      {hasNextPage && onLoadMore ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          isLoading={isFetchingNextPage ?? false}
          onClick={onLoadMore}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function RepositoryCard({repository}: {repository: Repository}) {
  const {ref: nameRef, isTruncated} = useIsTextTruncated<HTMLSpanElement>(repository.name);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <RadioGroupItem value={repository.externalRepositoryId} className="min-w-0">
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
      <div aria-hidden="true" className={REPOSITORY_GRID_CLASS_NAME}>
        {/* The skeleton mirrors RadioGroupItem's own 14px padding contract so the
            placeholder and the loaded card stay the same height. */}
        {REPOSITORY_SKELETON_WIDTHS.map((width) => (
          <div
            key={width}
            className="h-50 min-w-0 rounded-8 border border-border-neutral-base bg-background-neutral-base p-[14px]"
          >
            <Skeleton className={`h-20 ${width}`} />
          </div>
        ))}
      </div>
    </>
  );
}
