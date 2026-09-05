import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {WorkflowRunDetailPage} from '#pages/workflow-run-detail-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {workspaceSlug, projectSlug, workflowRunId} = useRouteParams(workflowRouteParams);
    const search = useRouteSearch(validateWorkflowRunsSearch);
    return (
      <ProjectRoute>
        {(project) => (
          <WorkflowRunDetailPage
            projectId={project.id}
            workspaceId={project.workspaceId}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            search={search}
          />
        )}
      </ProjectRoute>
    );
  },
});
