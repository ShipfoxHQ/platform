import type {QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';

export function EventsListSkeleton() {
  return (
    <div
      className="flex flex-col divide-y divide-border-neutral-base"
      role="status"
      aria-label="Loading events"
    >
      {Array.from({length: 8}).map((_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton row, stable position
          key={index}
          className="flex min-h-44 items-center gap-cluster px-row py-row"
        >
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-12 w-1/4" />
          <Skeleton className="h-12 w-20" />
          <Skeleton className="ml-auto h-12 w-40" />
        </div>
      ))}
    </div>
  );
}

export function EventsListEmpty({workspaceSlug}: {workspaceSlug?: string | undefined}) {
  return (
    <EmptyState
      icon="pulseLine"
      title="No events yet"
      description="Events appear here once a connected integration delivers one or you fire a trigger."
      action={
        workspaceSlug ? (
          <Button asChild size="sm" variant="secondary">
            <Link to="/w/$workspaceSlug/settings/integrations" params={{workspaceSlug}}>
              Configure integrations
            </Link>
          </Button>
        ) : undefined
      }
      variant="panel"
    />
  );
}

export function EventsListNoMatches({onClear}: {onClear: () => void}) {
  return (
    <EmptyState
      icon="filterOffLine"
      title="No matching events"
      description="No events match your current filters."
      action={
        <Button type="button" size="sm" variant="secondary" onClick={onClear}>
          Clear filters
        </Button>
      }
      variant="panel"
    />
  );
}

/**
 * Slim banner shown when a background refetch fails after a prior success, so the loaded
 * rows stay on screen with the retry inline rather than being wiped by a full placeholder.
 */
export function EventsListStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="p-tight">
      <Callout role="alert" type="error">
        <div className="flex items-center justify-between gap-inline">
          <Text size="xs">Could not refresh events.</Text>
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
