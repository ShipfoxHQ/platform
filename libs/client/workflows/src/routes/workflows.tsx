import {useMaybeActiveProject} from '@shipfox/client-projects';
import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';
import {workflowRouteParams} from './inputs.js';

export default defineRoute({
  component: () => {
    // Validate the generated route params before rendering the project-scoped page.
    useRouteParams(workflowRouteParams);
    const project = useMaybeActiveProject();
    if (!project) return <FullPageLoader />;
    return <ProjectWorkflowsPage projectId={project.id} />;
  },
});
