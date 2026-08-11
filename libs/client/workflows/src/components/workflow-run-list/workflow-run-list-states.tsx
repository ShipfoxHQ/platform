import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';

const SKELETON_ROW_COUNT = 8;

/**
 * Placeholder rows at the real row height, so the list does not resize under the cursor when
 * the first page lands. Only the initial load renders these: a refetch keeps the rows it has,
 * per the design system's rule against animating frequently-updating data.
 */
export function WorkflowRunListSkeleton() {
  return (
    <Panel role="status" aria-label="Loading runs" className="@container divide-y">
      {Array.from({length: SKELETON_ROW_COUNT}).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={index}
          className="flex min-h-44 items-center gap-inline px-row py-row @min-[976px]:h-44 @min-[976px]:py-0"
        >
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <Skeleton className="h-12 w-[220px] max-w-[40%]" />
          <Skeleton className="ml-auto hidden h-12 w-96 @min-[1200px]:block" />
          <Skeleton className="h-12 w-48" />
          <Skeleton className="h-12 w-48" />
        </div>
      ))}
    </Panel>
  );
}

/**
 * Slim non-blocking banner shown when a background refetch fails after a prior success,
 * so the already-loaded rows stay on screen with the retry inline rather than being
 * replaced by a full-placeholder error.
 */
export function WorkflowRunListStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="pb-[8px]">
      <Callout role="alert" type="error">
        <div className="flex items-center justify-between gap-inline">
          <Text size="xs">Could not refresh workflow runs.</Text>
          <Button
            type="button"
            size="2xs"
            variant="secondary"
            isLoading={query.isFetching}
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </Callout>
    </div>
  );
}

export function WorkflowRunListEmpty({
  workspaceSlug,
  projectSlug,
}: {
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  return (
    <EmptyState
      icon="pulseLine"
      title="No runs yet"
      description="Runs from this project's workflows appear here the moment one is launched."
      action={
        workspaceSlug && projectSlug ? (
          <Button asChild type="button" size="sm" variant="primary">
            <Link
              to="/w/$workspaceSlug/p/$projectSlug/workflows"
              params={{workspaceSlug, projectSlug}}
            >
              View workflows
            </Link>
          </Button>
        ) : null
      }
      variant="panel"
    />
  );
}

/**
 * The filtered-empty state, deliberately distinct from the unfiltered one: someone who
 * filtered their way to nothing needs a way back out, not an onboarding call to action.
 *
 * Its reset is worded as its outcome rather than repeating the toolbar's "Clear filters"
 * verbatim, so the two controls on screen read as one action offered twice rather than two
 * different ones. It is also the only reset within reach below `md`, where the toolbar's
 * lives inside the filter sheet.
 */
export function WorkflowRunListNoMatches({
  onClear,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: {
  onClear: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore?: () => void;
}) {
  return (
    <Panel>
      <div className="flex flex-col gap-inline">
        {isFetchNextPageError ? (
          <Callout role="alert" type="error">
            Could not load more workflow runs. Try again to continue searching older runs.
          </Callout>
        ) : null}
        <EmptyState
          icon="filterOffLine"
          title={hasNextPage ? 'No matches in loaded history' : 'No matching runs'}
          description={
            hasNextPage
              ? 'No loaded run matches these filters. Load more to search further back.'
              : 'No run matches these filters.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-inline">
              {hasNextPage && onLoadMore ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  isLoading={isFetchingNextPage}
                  onClick={onLoadMore}
                >
                  Load more runs
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="secondary" onClick={onClear}>
                Show all runs
              </Button>
            </div>
          }
          variant="panel"
        />
      </div>
    </Panel>
  );
}

export function WorkflowRunListLoadMore({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore?: () => void;
}) {
  if (!hasNextPage || !onLoadMore) return null;

  return (
    <div className="flex flex-col items-center gap-inline border-t border-border-neutral-base py-row">
      {isFetchNextPageError ? (
        <Callout role="alert" type="error">
          Could not load more workflow runs. Try again.
        </Callout>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        isLoading={isFetchingNextPage}
        onClick={onLoadMore}
      >
        Load more runs
      </Button>
    </div>
  );
}
