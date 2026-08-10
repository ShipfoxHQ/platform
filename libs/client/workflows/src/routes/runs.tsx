import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {WorkflowRunsPage} from '#pages/workflow-run-list-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {workspaceSlug, projectSlug} = useRouteParams(workflowRouteParams);
    const search = useRouteSearch(validateWorkflowRunsSearch);
    return (
      <ProjectRoute>
        {(project) => (
          <WorkflowRunsPage
            projectId={project.id}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            search={search}
          />
        )}
      </ProjectRoute>
    );
  },
});
