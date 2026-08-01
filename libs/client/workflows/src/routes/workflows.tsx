import {useMaybeActiveProjectQuery} from '@shipfox/client-projects';
import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';
import {workflowRouteParams} from './inputs.js';

export default defineRoute({
  component: () => {
    // Validate the generated route params before rendering the project-scoped page.
    useRouteParams(workflowRouteParams);
    const projectQuery = useMaybeActiveProjectQuery();
    if (projectQuery.isPending) return <FullPageLoader />;
    if (projectQuery.isError) return <QueryLoadError query={projectQuery} subject="project" />;
    const project = projectQuery.data;
    if (!project) return <FullPageLoader />;
    return <ProjectWorkflowsPage projectId={project.id} />;
  },
});
