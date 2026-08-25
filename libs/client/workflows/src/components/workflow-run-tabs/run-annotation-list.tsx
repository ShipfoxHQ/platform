import {QueryLoadError, type QueryLoadErrorQuery} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {PanelBody, PanelRow} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {type ReactNode, useState} from 'react';
import type {RunAnnotationEntry, RunAnnotationStyle} from '#core/run-annotation.js';
import {RunAnnotationItem, RunDerivedAnnotationItem} from './run-annotation-item.js';
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
  /** Synthetic terminal-job diagnostics for jobs that never created an execution record. */
  derivedAnnotations?: readonly DerivedRunAnnotation[] | undefined;
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
}

export interface DerivedRunAnnotation {
  id: string;
  style: RunAnnotationStyle;
  jobName: string;
  body: string;
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
 * The annotations list, and the whole body of the panel it sits in.
 *
 * It owns the panel body rather than being dropped into a padded one, because each of its
 * states wants a different treatment: rows are flush cells divided by hairlines, an empty state
 * fills the body, and the banners above and below the rows are bands with their own padding.
 *
 * Loading, empty, error, and stale are four distinct renderings on purpose: coalescing a failed
 * fetch into an empty result tells a reader their run is clean when the truth is unknown.
 */
export function RunAnnotationList({
  query,
  entries,
  derivedAnnotations = [],
  workflowRunId,
  workspaceSlug,
  projectSlug,
  runAttempt,
  filteredJobName,
  filteredSeverity,
  filtered,
  onClearFilters,
}: RunAnnotationListProps) {
  const [visibleCount, setVisibleCount] = useState(RENDER_WINDOW);

  if (query.isPending) return <RunAnnotationListSkeleton />;

  if (query.isError && entries === undefined) {
    return (
      <PanelBody className="p-panel">
        <QueryLoadError query={query} subject="annotations" icon="fileDamageLine" />
      </PanelBody>
    );
  }

  if (entries === undefined) return <RunAnnotationListSkeleton />;

  const visible = entries.slice(0, visibleCount);
  const hiddenCount = entries.length - visible.length;
  const totalCount = entries.length + derivedAnnotations.length;
  const hasContent = totalCount > 0;

  return (
    <>
      {query.isError ? <RunAnnotationStaleError query={query} /> : null}

      {!hasContent ? (
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
        <PanelBody asChild>
          <ol>
            {/* A job that failed before it ever created an execution is the most upstream thing
                in the run, and it has no step to link to. It leads rather than trailing behind a
                render window that could bury it. */}
            {derivedAnnotations.map((annotation) => (
              <RunDerivedAnnotationItem
                key={annotation.id}
                style={annotation.style}
                jobName={annotation.jobName}
                body={annotation.body}
              />
            ))}
            {visible.map((entry) => (
              <RunAnnotationItem
                key={entry.annotation.id}
                entry={entry}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                workflowRunId={workflowRunId}
                runAttempt={runAttempt}
              />
            ))}
          </ol>
        </PanelBody>
      )}

      {hiddenCount > 0 ? (
        <RunAnnotationListFooter>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="[@media(pointer:coarse)]:min-h-44"
            onClick={() => setVisibleCount((current) => current + RENDER_WINDOW)}
          >
            Show {Math.min(hiddenCount, RENDER_WINDOW)} more of {totalCount}
          </Button>
        </RunAnnotationListFooter>
      ) : query.hasNextPage ? (
        <RunAnnotationListFooter>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="[@media(pointer:coarse)]:min-h-44"
            isLoading={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            Load more annotations
          </Button>
        </RunAnnotationListFooter>
      ) : null}
    </>
  );
}

/** A band below the rows, separated by the same hairline that divides them. */
function RunAnnotationListFooter({children}: {children: ReactNode}) {
  return (
    <div className="flex border-t border-border-neutral-base bg-background-neutral-base px-row py-row">
      {children}
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
    <EmptyState
      variant="panel"
      icon="fileDamageLine"
      title={incomplete ? 'No matches in loaded annotations' : 'No matching annotations'}
      description={filteredEmptyDescription({jobName, severity, incomplete})}
      action={
        onClearFilters ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="[@media(pointer:coarse)]:min-h-44"
            onClick={onClearFilters}
          >
            Clear filters
          </Button>
        ) : null
      }
    />
  );
}

/**
 * A failed poll keeps the annotations already on screen and marks them stale rather than
 * clearing. Polite rather than assertive: the poll runs every 4s and a flapping API would
 * otherwise interrupt a screen reader on every cycle.
 *
 * A band inside the panel rather than a bordered notice, because the hairline below it already
 * separates it from the rows and a second frame would be a box inside a box.
 */
function RunAnnotationStaleError({query}: {query: QueryLoadErrorQuery}) {
  return (
    <div className="border-b border-border-neutral-base bg-background-neutral-base px-row py-row">
      <Callout role="status" aria-live="polite" type="error" variant="secondary">
        <CalloutContent className="flex items-center justify-between gap-inline">
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
        </CalloutContent>
      </Callout>
    </div>
  );
}

const ANNOTATION_SKELETON_ROWS = ['first', 'second', 'third'];

function RunAnnotationListSkeleton() {
  return (
    <PanelBody asChild>
      <ul aria-label="Loading annotations" role="status">
        {ANNOTATION_SKELETON_ROWS.map((row) => (
          <PanelRow
            asChild
            key={row}
            className="items-start justify-start gap-cluster hover:bg-background-neutral-base"
          >
            <li>
              <Skeleton className="size-16 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-inline">
                <Skeleton className="h-20 w-160 rounded-4" />
                <Skeleton className="h-16 w-240 rounded-4" />
                <Skeleton className="h-40 w-full rounded-4" />
              </div>
            </li>
          </PanelRow>
        ))}
      </ul>
    </PanelBody>
  );
}
