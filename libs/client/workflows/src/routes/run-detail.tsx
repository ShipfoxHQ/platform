import {useMaybeActiveProjectQuery} from '@shipfox/client-projects';
import {defineRoute, useRouteParams, useRouteSearch} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {WorkflowRunPage} from '#pages/workflow-run-page.js';
import {validateWorkflowRunsSearch, workflowRouteParams} from './inputs.js';

export default defineRoute({
  staticData: {layout: 'full-bleed'},
  validateSearch: validateWorkflowRunsSearch,
  component: () => {
    const {workspaceSlug, projectSlug, workflowRunId} = useRouteParams(workflowRouteParams);
    const projectQuery = useMaybeActiveProjectQuery();
    const search = useRouteSearch(validateWorkflowRunsSearch);
    if (projectQuery.isPending) return <FullPageLoader />;
    if (projectQuery.isError) return <QueryLoadError query={projectQuery} subject="project" />;
    const project = projectQuery.data;
    if (!project) return <FullPageLoader />;
    return (
      <WorkflowRunPage
        projectId={project.id}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        search={search}
      />
    );
  },
});
