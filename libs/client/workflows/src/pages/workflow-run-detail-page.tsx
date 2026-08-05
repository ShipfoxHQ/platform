import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import {type WorkflowRunsSearch, workflowRunTab} from '#routes/inputs.js';

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
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background-neutral-background">
      <WorkflowRunView
        projectId={projectId}
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
