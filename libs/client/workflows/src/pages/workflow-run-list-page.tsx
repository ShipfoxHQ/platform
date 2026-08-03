import {useNavigate} from '@tanstack/react-router';
import {useCallback} from 'react';
import type {WorkflowRunListStatusFilter} from '#components/workflow-run-list/types.js';
import {WorkflowRunList} from '#components/workflow-run-list/workflow-run-list.js';
import {type WorkflowRunsSearch, workflowRunSearchParams} from '#routes/inputs.js';

interface WorkflowRunsPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  search?: WorkflowRunsSearch;
}

export function WorkflowRunsPage({
  projectId,
  workspaceSlug,
  projectSlug,
  search = {},
}: WorkflowRunsPageProps) {
  const navigate = useNavigate();
  const onFiltersChange = useCallback(
    (filters: {search?: string; status?: WorkflowRunListStatusFilter}) => {
      const nextSearch = {...search};
      if (filters.search !== undefined) {
        if (filters.search) nextSearch.search = filters.search;
        else delete nextSearch.search;
      }
      if (filters.status !== undefined) {
        if (filters.status === 'all') delete nextSearch.status;
        else nextSearch.status = filters.status;
      }
      navigate({
        search: workflowRunSearchParams(nextSearch, {}) as never,
        replace: true,
      });
    },
    [navigate, search],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background-neutral-base p-16">
      <div className="mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col">
        <WorkflowRunList
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          search={search.search ?? ''}
          statusFilter={search.status ?? 'all'}
          onFiltersChange={onFiltersChange}
          className="min-h-0 w-full rounded-8 border border-border-neutral-base"
        />
      </div>
    </div>
  );
}
