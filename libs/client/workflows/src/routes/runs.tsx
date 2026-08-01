import {useMaybeActiveProject} from '@shipfox/client-projects';
import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {WorkflowRunPage} from '#pages/workflow-run-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';

export default defineRoute({
  staticData: {layout: 'full-bleed'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {workspaceSlug, projectSlug} = useRouteParams(workflowRouteParams);
    const project = useMaybeActiveProject();
    const search = useRouteSearch(validateWorkflowRunsSearch);
    if (!project) return <FullPageLoader />;
    return (
      <WorkflowRunPage
        projectId={project.id}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        search={search}
      />
    );
  },
});
