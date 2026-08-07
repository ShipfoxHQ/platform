import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';

export function WorkflowRunSkeleton() {
  return (
    <section
      aria-label="Loading workflow run"
      className="bg-background-neutral-background px-row py-row"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-cluster gap-y-inline">
        <div className="flex min-w-0 items-center gap-inline">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-24 w-180 rounded-6" />
        </div>
        <Skeleton className="h-24 w-88 rounded-6" />
        <span
          aria-hidden="true"
          className="hidden h-20 w-px shrink-0 bg-border-neutral-base sm:block"
        />
        <Skeleton className="h-20 w-64 rounded-4" />
        <Skeleton className="h-20 w-112 rounded-4" />
        <span className="min-w-0 flex-1" />
        <Skeleton className="h-20 w-88 rounded-4" />
        <Skeleton className="h-20 w-88 rounded-4" />
      </div>
    </section>
  );
}

export function WorkflowRunContentSkeleton() {
  return (
    <section
      aria-label="Loading workflow run content"
      className="min-h-160 rounded-8 border border-border-neutral-base bg-background-components-base p-panel-compact"
    >
      <Skeleton className="h-160 w-full rounded-6" />
    </section>
  );
}

export function WorkflowRunNotFound() {
  return (
    <EmptyState
      icon="pulseLine"
      title="Run not found"
      description="This run does not exist or is no longer available."
    />
  );
}

/**
 * Slim non-blocking banner shown when a background refetch fails after the run already
 * loaded (active-run polling can hit a transient API error), so the loaded run stays on
 * screen with an inline retry instead of being wiped by a full error placeholder.
 */
export function WorkflowRunStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="border-b border-border-neutral-base p-tight">
      <Callout role="alert" type="error">
        <div className="flex items-center justify-between gap-inline">
          <Text size="xs">Could not refresh this run.</Text>
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
