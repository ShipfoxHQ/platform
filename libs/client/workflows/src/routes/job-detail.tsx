import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {WorkflowJobDetailPage} from '#pages/workflow-job-detail-page.js';
import {validateWorkflowJobSearch, workflowJobRouteParams} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  validateSearch: validateWorkflowJobSearch,
  component: () => {
    const {workspaceSlug, projectSlug, workflowRunId, jobId} =
      useRouteParams(workflowJobRouteParams);
    const search = useRouteSearch(validateWorkflowJobSearch);

    return (
      <ProjectRoute>
        {(project) => (
          <WorkflowJobDetailPage
            projectId={project.id}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            jobId={jobId}
            search={search}
          />
        )}
      </ProjectRoute>
    );
  },
});
