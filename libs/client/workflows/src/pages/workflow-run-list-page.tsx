import {useNavigate} from '@tanstack/react-router';
import {useCallback} from 'react';
import {WorkflowRunList} from '#components/workflow-run-list/workflow-run-list.js';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  type WorkflowRunFilterPatch,
  type WorkflowRunsSearch,
  workflowRunSearchParams,
} from '#routes/inputs.js';

interface WorkflowRunsPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  search?: WorkflowRunsSearch;
}

const EMPTY_SEARCH: WorkflowRunsSearch = {};

export function WorkflowRunsPage({
  projectId,
  workspaceSlug,
  projectSlug,
  search = EMPTY_SEARCH,
}: WorkflowRunsPageProps) {
  const navigate = useNavigate();

  // Filter changes replace history instead of pushing it, so Back leaves the list rather than
  // walking every keystroke of a search box.
  const commitSearch = useCallback(
    (next: WorkflowRunsSearch) => {
      navigate({
        search: workflowRunSearchParams(next, {}) as never,
        replace: true,
      });
    },
    [navigate],
  );

  const onFiltersChange = useCallback(
    (patch: WorkflowRunFilterPatch) => commitSearch(applyWorkflowRunFilterPatch(search, patch)),
    [commitSearch, search],
  );

  const onClearFilters = useCallback(
    () => commitSearch(clearWorkflowRunFilters(search)),
    [commitSearch, search],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background-neutral-base">
      <div className="mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col px-24 py-24">
        <WorkflowRunList
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          search={search}
          onFiltersChange={onFiltersChange}
          onClearFilters={onClearFilters}
        />
      </div>
    </div>
  );
}
