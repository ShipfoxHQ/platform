import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import {type WorkflowRunsSearch, workflowRunTab} from '#routes/inputs.js';

interface WorkflowRunDetailPageProps {
  projectId: string;
  workspaceId?: string | undefined;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId?: string | undefined;
  search?: WorkflowRunsSearch;
}

export function WorkflowRunDetailPage({
  projectId,
  workspaceId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search = {},
}: WorkflowRunDetailPageProps) {
  return (
    <div data-workflow-page-root="run-detail" className="flex min-h-0 flex-1 overflow-hidden">
      <WorkflowRunView
        projectId={projectId}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        runAttempt={search.runAttempt}
        selection={search}
        tab={workflowRunTab(search)}
      />
    </div>
  );
}
