import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {WorkflowRunPage} from '#pages/workflow-run-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {layout: 'full-bleed'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {workspaceSlug, projectSlug} = useRouteParams(workflowRouteParams);
    const search = useRouteSearch(validateWorkflowRunsSearch);
    return (
      <ProjectRoute>
        {(project) => (
          <WorkflowRunPage
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
