import {QueryLoadError} from '@shipfox/client-ui';
import type {WorkflowRunListItem} from '#core/workflow-run.js';
import type {WorkflowRunListQuery} from './types.js';
import {
  WorkflowRunListEmpty,
  WorkflowRunListNoMatches,
  WorkflowRunListSkeleton,
  WorkflowRunListStaleError,
} from './workflow-run-list-states.js';
import {WorkflowRunRowList} from './workflow-run-row.js';

interface WorkflowRunListContentProps {
  query: WorkflowRunListQuery;
  totalRuns: number;
  runs: WorkflowRunListItem[];
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  selectedWorkflowRunId?: string | undefined;
  onClearFilters: () => void;
}

export function WorkflowRunListContent({
  query,
  totalRuns,
  runs,
  workspaceSlug,
  projectSlug,
  selectedWorkflowRunId,
  onClearFilters,
}: WorkflowRunListContentProps) {
  const {isPending, isError} = query;
  // A refetch that fails after a prior success keeps the rows on screen behind a slim
  // banner. QueryLoadError owns the inverse case (errored before anything loaded) and
  // self-gates to nothing here once data exists.
  const refreshFailed = isError && query.data !== undefined;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {isPending ? <WorkflowRunListSkeleton /> : null}
      {!isPending ? (
        <QueryLoadError query={query} subject="workflow runs" icon="pulseLine" />
      ) : null}
      {!isPending && refreshFailed ? <WorkflowRunListStaleError query={query} /> : null}
      {!isPending && !isError && totalRuns === 0 ? <WorkflowRunListEmpty /> : null}
      {!isPending && totalRuns > 0 && runs.length === 0 ? (
        <WorkflowRunListNoMatches onClear={onClearFilters} />
      ) : null}
      {!isPending && runs.length > 0 ? (
        <WorkflowRunRowList
          runs={runs}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          selectedWorkflowRunId={selectedWorkflowRunId}
        />
      ) : null}
    </div>
  );
}
