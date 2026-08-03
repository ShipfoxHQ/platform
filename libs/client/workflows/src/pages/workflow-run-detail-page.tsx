import {useNavigate} from '@tanstack/react-router';
import {useCallback} from 'react';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';
import {type WorkflowRunsSearch, workflowRunSearchParams} from '#routes/inputs.js';

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
        search: workflowRunSearchParams(search, nextSelection) as never,
      });
    },
    [navigate, search],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background-neutral-base">
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
