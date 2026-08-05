import {QueryLoadError, type QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {useState} from 'react';
import type {RunAnnotationEntry} from '#core/run-annotation.js';
import {RunAnnotationItem} from './run-annotation-item.js';
import {RunAnnotationsEmpty} from './run-annotations-empty.js';

export interface RunAnnotationListQuery extends QueryLoadErrorQuery {
  isPending: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
}

export interface RunAnnotationListProps {
  query: RunAnnotationListQuery;
  entries: RunAnnotationEntry[] | undefined;
  workflowRunId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  runAttempt?: number | undefined;
  /** Name of the job the list is filtered to, used only for empty-state copy. */
  filteredJobName?: string | undefined;
  /** Active severity filter, named in the empty state so the reader knows what to clear. */
  filteredSeverity?: string | undefined;
  filtered: boolean;
  onClearFilters?: (() => void) | undefined;
  /** Annotation id from `?annotation=`, which the matching card scrolls to and focuses. */
  selectedAnnotationId?: string | undefined;
}

/**
 * How many annotations render at once.
 *
 * A page holds up to 500 rows and each one mounts a Markdown pipeline, so the fetch budget is
 * not a render budget. The window grows on demand and the server page only loads once the
 * reader has actually seen everything already fetched.
 */
const RENDER_WINDOW = 25;

/**
 * The annotations list.
 *
 * Loading, empty, error, and stale are four distinct renderings on purpose: coalescing a failed
 * fetch into an empty result tells a reader their run is clean when the truth is unknown.
 */
export function RunAnnotationList({
  query,
  entries,
  workflowRunId,
  workspaceSlug,
  projectSlug,
  runAttempt,
  filteredJobName,
  filteredSeverity,
  filtered,
  onClearFilters,
  selectedAnnotationId,
}: RunAnnotationListProps) {
  const [visibleCount, setVisibleCount] = useState(RENDER_WINDOW);

  // A deep-linked annotation past the window would otherwise be unreachable: it is in the data,
  // absent from the DOM, and nothing on screen says so.
  const selectedIndex = selectedAnnotationId
    ? (entries?.findIndex((entry) => entry.annotation.id === selectedAnnotationId) ?? -1)
    : -1;
  const renderCount = Math.max(visibleCount, selectedIndex + 1);

  if (query.isPending) return <RunAnnotationListSkeleton />;

  if (query.isError && entries === undefined) {
    return <QueryLoadError query={query} subject="annotations" icon="fileDamageLine" />;
  }

  if (entries === undefined) return <RunAnnotationListSkeleton />;

  const visible = entries.slice(0, renderCount);
  const hiddenCount = entries.length - visible.length;

  return (
    <div className="flex min-w-0 flex-col gap-12">
      {query.isError ? <RunAnnotationStaleError query={query} /> : null}

      {entries.length === 0 ? (
        filtered ? (
          <RunAnnotationsFilteredEmpty
            jobName={filteredJobName}
            severity={filteredSeverity}
            incomplete={query.hasNextPage}
            onClearFilters={onClearFilters}
          />
        ) : (
          <RunAnnotationsEmpty />
        )
      ) : (
        <ol className="flex min-w-0 flex-col gap-12">
          {visible.map((entry) => (
            <RunAnnotationItem
              key={entry.annotation.id}
              entry={entry}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              workflowRunId={workflowRunId}
              runAttempt={runAttempt}
              selected={entry.annotation.id === selectedAnnotationId}
            />
          ))}
        </ol>
      )}

      {hiddenCount > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start [@media(pointer:coarse)]:min-h-44"
          onClick={() => setVisibleCount((current) => current + RENDER_WINDOW)}
        >
          Show {Math.min(hiddenCount, RENDER_WINDOW)} more of {entries.length}
        </Button>
      ) : query.hasNextPage ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="self-start [@media(pointer:coarse)]:min-h-44"
          isLoading={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          Load more annotations
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Names the filters that are actually active.
 *
 * Blaming severity for a job-only filter sends the reader to change the wrong control, which
 * is worse than saying nothing.
 */
function filteredEmptyDescription({
  jobName,
  severity,
  incomplete,
}: {
  jobName: string | undefined;
  severity: string | undefined;
  incomplete: boolean;
}): string {
  if (incomplete) {
    if (jobName && severity) {
      return `None of the loaded annotations are from ${jobName} at ${severity} severity. Load more annotations to continue searching.`;
    }
    if (jobName) {
      return `None of the loaded annotations are from ${jobName}. Load more annotations to continue searching.`;
    }
    if (severity) {
      return `None of the loaded annotations are at ${severity} severity. Load more annotations to continue searching.`;
    }
    return 'None of the loaded annotations match the current filters. Load more annotations to continue searching.';
  }
  if (jobName && severity) {
    return `This run has annotations, but none from ${jobName} at ${severity} severity.`;
  }
  if (jobName) return `This run has annotations, but none from ${jobName}.`;
  if (severity) return `This run has annotations, but none at ${severity} severity.`;
  return 'This run has annotations, but none match the current filters.';
}

function RunAnnotationsFilteredEmpty({
  jobName,
  severity,
  incomplete,
  onClearFilters,
}: {
  jobName: string | undefined;
  severity: string | undefined;
  incomplete: boolean;
  onClearFilters: (() => void) | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-12">
      <EmptyState
        icon="fileDamageLine"
        title={incomplete ? 'No matches in loaded annotations' : 'No matching annotations'}
        description={filteredEmptyDescription({jobName, severity, incomplete})}
      />
      {onClearFilters ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="[@media(pointer:coarse)]:min-h-44"
          onClick={onClearFilters}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A failed poll keeps the annotations already on screen and marks them stale rather than
 * clearing. Polite rather than assertive: the poll runs every 4s and a flapping API would
 * otherwise interrupt a screen reader on every cycle.
 */
function RunAnnotationStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <Callout role="status" aria-live="polite" type="error">
      <div className="flex w-full items-center justify-between gap-8">
        <Text size="xs">Could not refresh annotations.</Text>
        <Button
          type="button"
          size="2xs"
          variant="secondary"
          className="[@media(pointer:coarse)]:min-h-44"
          isLoading={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    </Callout>
  );
}

const ANNOTATION_SKELETON_ROWS = ['first', 'second', 'third'];

function RunAnnotationListSkeleton() {
  return (
    <section aria-label="Loading annotations" className="flex flex-col gap-12">
      {ANNOTATION_SKELETON_ROWS.map((row) => (
        <div
          key={row}
          className="flex gap-12 rounded-8 border border-border-neutral-base bg-background-components-base px-12 py-8"
        >
          <Skeleton className="h-40 w-4 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <Skeleton className="h-20 w-160 rounded-4" />
            <Skeleton className="h-16 w-240 rounded-4" />
            <Skeleton className="h-40 w-full rounded-4" />
          </div>
        </div>
      ))}
    </section>
  );
}
