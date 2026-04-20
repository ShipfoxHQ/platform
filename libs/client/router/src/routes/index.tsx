import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {ProjectsHubPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <ProjectsHubPage />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
