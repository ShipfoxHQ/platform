import {Button} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {Code, Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useEffect, useState} from 'react';
import type {
  WorkflowRunAttempt,
  WorkflowRunListItem,
  WorkflowRunOverview,
} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAttemptsQuery} from '#hooks/api/workflow-runs.js';
import {WorkflowStatusIcon} from '../workflow-status/workflow-status-icon.js';

export interface WorkflowRunAttemptSwitcherProps {
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  run: WorkflowRunOverview | WorkflowRunListItem;
  latestAttempt: number;
}

export function WorkflowRunAttemptSwitcher({
  workspaceSlug,
  projectSlug,
  run,
  latestAttempt,
}: WorkflowRunAttemptSwitcherProps) {
  const [open, setOpen] = useState(false);
  const attemptsQuery = useWorkflowRunAttemptsQuery({
    workflowRunId: run.id,
    enabled: open,
  });

  const attempts = attemptsQuery.data ?? [];
  const latestLoadedAttempt = Math.max(0, ...attempts.map((attempt) => attempt.attempt));
  const maxAttempt = Math.max(latestAttempt, run.runAttempt.attempt, latestLoadedAttempt);
  const isLoadingMissingAttempt =
    attempts.length > 0 && attemptsQuery.isFetching && latestLoadedAttempt < maxAttempt;

  useEffect(() => {
    // A pinned historical run can sit outside the newest page. Bring just enough older history
    // into the picker to keep that selected attempt addressable; the explicit menu item remains
    // available for browsing still older attempts without eagerly downloading the whole lineage.
    if (
      !open ||
      attemptsQuery.isPending ||
      (attemptsQuery.isError && attempts.length === 0) ||
      attemptsQuery.isFetching ||
      attemptsQuery.isFetchingNextPage ||
      attemptsQuery.isFetchNextPageError ||
      attempts.some((attempt) => attempt.attempt === run.runAttempt.attempt) ||
      !attemptsQuery.hasNextPage
    ) {
      return;
    }
    void attemptsQuery.fetchNextPage();
  }, [
    attempts,
    attemptsQuery.fetchNextPage,
    attemptsQuery.hasNextPage,
    attemptsQuery.isError,
    attemptsQuery.isFetchNextPageError,
    attemptsQuery.isFetching,
    attemptsQuery.isFetchingNextPage,
    attemptsQuery.isPending,
    open,
    run.runAttempt.attempt,
  ]);

  if (latestAttempt <= 1) return null;
  if (!workspaceSlug || !projectSlug) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="transparentMuted"
          size="2xs"
          iconRight="arrowDownSLine"
          aria-label={`Switch attempt, currently ${run.runAttempt.attempt} of ${maxAttempt}`}
          className="h-20 px-[4px] text-foreground-neutral-subtle hover:text-foreground-neutral-base"
        >
          <Text as="span" size="xs" className="text-inherit">
            Attempt {run.runAttempt.attempt} of {maxAttempt}
          </Text>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="lg">
        {attemptsQuery.isPending && attempts.length === 0 ? <LoadingRow /> : null}
        {isLoadingMissingAttempt ? <LoadingRow /> : null}
        {attemptsQuery.isError && attempts.length === 0 ? (
          <ErrorRow onRetry={() => void attemptsQuery.refetch()} />
        ) : null}
        {attempts.length > 0
          ? [...attempts]
              .sort((left, right) => right.attempt - left.attempt)
              .map((attempt) => (
                <AttemptItem
                  key={attempt.id}
                  attempt={attempt}
                  current={attempt.attempt === run.runAttempt.attempt}
                  workflowRunId={run.id}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                />
              ))
          : null}
        {attemptsQuery.isFetchNextPageError ? (
          <ErrorRow
            label="Could not load older attempts. Retry"
            onRetry={() => void attemptsQuery.fetchNextPage()}
          />
        ) : null}
        {attemptsQuery.hasNextPage ? (
          <DropdownMenuItem
            closeOnSelect={false}
            disabled={attemptsQuery.isFetchingNextPage}
            onSelect={() => void attemptsQuery.fetchNextPage()}
          >
            <Text as="span" size="sm" className="text-foreground-neutral-muted">
              {attemptsQuery.isFetchingNextPage
                ? 'Loading older attempts...'
                : 'Load older attempts'}
            </Text>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LoadingRow() {
  return (
    <DropdownMenuItem disabled>
      <Text as="span" size="sm" className="text-foreground-neutral-muted">
        Loading attempts...
      </Text>
    </DropdownMenuItem>
  );
}

function ErrorRow({
  label = 'Could not load attempts. Retry',
  onRetry,
}: {
  label?: string;
  onRetry: () => void;
}) {
  return (
    <DropdownMenuItem closeOnSelect={false} onSelect={onRetry}>
      <Text as="span" size="sm" className="text-foreground-highlight-error">
        {label}
      </Text>
    </DropdownMenuItem>
  );
}

function AttemptItem({
  attempt,
  current,
  workflowRunId,
  workspaceSlug,
  projectSlug,
}: {
  attempt: WorkflowRunAttempt;
  current: boolean;
  workflowRunId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}) {
  return (
    <DropdownMenuItem asChild className={cn(current && 'text-foreground-neutral-base')}>
      <Link
        to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
        params={{workspaceSlug, projectSlug, workflowRunId}}
        search={
          ((previous: Record<string, unknown>) => {
            if (current) return previous;
            return {
              ...withoutWorkflowRunSelectionSearch(previous),
              runAttempt: attempt.attempt,
            };
          }) as never
        }
        aria-current={current ? 'page' : undefined}
      >
        <WorkflowStatusIcon status={attempt.status} size={14} tooltip={false} />
        <Code as="span" variant="label" className="min-w-0 flex-1 truncate text-inherit">
          Attempt {attempt.attempt}
        </Code>
        <RelativeTime
          value={attempt.createdAt}
          className="shrink-0 whitespace-nowrap font-code text-xs leading-20 text-foreground-neutral-subtle"
        />
      </Link>
    </DropdownMenuItem>
  );
}
