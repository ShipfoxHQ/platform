import {defineRoute} from '@shipfox/client-shell/runtime';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';
import {ProjectRoute} from './project-route.js';

export default defineRoute({
  staticData: {frame: 'data'},
  component: () => {
    return (
      <ProjectRoute>{(project) => <ProjectWorkflowsPage projectId={project.id} />}</ProjectRoute>
    );
  },
});
