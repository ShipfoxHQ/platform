import {useNavigate} from '@tanstack/react-router';
import {useCallback} from 'react';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';
import {
  validateWorkflowRunsSearch,
  type WorkflowRunsSearch,
  type WorkflowRunTab,
  workflowRunSearchParams,
  workflowRunTab,
} from '#routes/inputs.js';

interface WorkflowRunDetailPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId?: string | undefined;
  search?: WorkflowRunsSearch;
}

export function WorkflowRunDetailPage({
  projectId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search = {},
}: WorkflowRunDetailPageProps) {
  const navigate = useNavigate();
  const selection: WorkflowRunSelectionInput = search;
  const onSelectionChange = useCallback(
    (nextSelection: WorkflowRunSelectionInput) => {
      navigate({
        search: ((previous: Record<string, unknown>) => {
          const current = validateWorkflowRunsSearch(previous);
          return workflowRunSearchParams(current, nextSelection);
        }) as never,
        replace: true,
      });
    },
    [navigate],
  );
  const onTabChange = useCallback(
    (nextTab: WorkflowRunTab) => {
      navigate({
        search: ((previous: Record<string, unknown>) => {
          const current = validateWorkflowRunsSearch(previous);
          const nextSearch = workflowRunSearchParams({...current, tab: nextTab}, current);
          return nextTab === 'summary' &&
            (current.jobId || current.jobExecutionId || current.stepId || current.stepAttemptId)
            ? {...nextSearch, tab: nextTab}
            : nextSearch;
        }) as never,
      });
    },
    [navigate],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background-neutral-background">
      <WorkflowRunView
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        selection={selection}
        onSelectionChange={onSelectionChange}
        tab={workflowRunTab(search)}
        onTabChange={onTabChange}
      />
    </div>
  );
}
