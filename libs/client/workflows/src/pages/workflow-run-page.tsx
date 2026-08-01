import {useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect} from 'react';
import {WorkflowRunList} from '#components/workflow-run-list/workflow-run-list.js';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';
import {useWorkflowRunsInfiniteQuery} from '#hooks/api/workflow-runs.js';
import {type WorkflowRunsSearch, workflowRunSearchParams} from '#routes/inputs.js';
import {WorkflowRunFirstTimeUse} from './workflow-run-first-time-use.js';

interface WorkflowRunPageProps {
  projectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  search?: WorkflowRunsSearch;
}

/**
 * Resolve which surface the runs path should show from a single read of the runs list:
 * - when opened without a workflow run id, point the URL at the most recent run so the detail pane is
 *   never empty (navigation happens in an effect since it mutates history);
 * - report `hasNoRuns` once the list has loaded with zero runs, so a brand-new project lands
 *   on the first-time-use surface instead of an empty rail and a perpetual detail skeleton.
 */
function useWorkflowRunPageTarget(
  projectId: string,
  workspaceSlug: string | undefined,
  projectSlug: string | undefined,
  workflowRunId: string | undefined,
  search: WorkflowRunsSearch,
) {
  const navigate = useNavigate();
  const {data, isPending} = useWorkflowRunsInfiniteQuery(projectId, {});
  const firstWorkflowRunId = data?.pages[0]?.runs[0]?.id;
  // Gate on data presence, not `!isError`: a transient refetch error after a prior success
  // keeps `data`, so the redirect (and the no-runs surface) still resolve from it instead of
  // stalling on the rail while active-run polling hits a blip.
  const isLoaded = !isPending && data !== undefined;

  useEffect(() => {
    if (workflowRunId || !isLoaded || !firstWorkflowRunId) return;
    if (!workspaceSlug || !projectSlug) return;
    navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {
        workspaceSlug,
        projectSlug,
        workflowRunId: firstWorkflowRunId,
      },
      search: workflowRunSearchParams(search, {}),
      replace: true,
    });
  }, [navigate, workspaceSlug, projectSlug, workflowRunId, isLoaded, firstWorkflowRunId, search]);

  return {hasNoRuns: isLoaded && firstWorkflowRunId === undefined};
}

export function WorkflowRunPage({
  projectId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search = {},
}: WorkflowRunPageProps) {
  const {hasNoRuns} = useWorkflowRunPageTarget(
    projectId,
    workspaceSlug,
    projectSlug,
    workflowRunId,
    search,
  );
  const navigate = useNavigate();
  const selection: WorkflowRunSelectionInput = search;
  const onSelectionChange = useCallback(
    (nextSelection: WorkflowRunSelectionInput) => {
      navigate({
        search: workflowRunSearchParams(search, nextSelection) as never,
      });
    },
    [navigate, search],
  );

  if (!workflowRunId && hasNoRuns) {
    return <WorkflowRunFirstTimeUse />;
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <WorkflowRunList
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        selectedWorkflowRunId={workflowRunId}
        search={search.search ?? ''}
        statusFilter={search.status ?? 'all'}
        onFiltersChange={(filters) =>
          navigate({search: workflowRunSearchParams({...search, ...filters}) as never})
        }
      />
      <WorkflowRunView
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />
    </div>
  );
}
