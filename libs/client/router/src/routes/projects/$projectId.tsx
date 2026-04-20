import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {ProjectDetailPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/projects/$projectId')({
  component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
  const {projectId} = Route.useParams();

  return (
    <AuthGuard>
      <WorkspaceGuard>
        <ProjectDetailPage projectId={projectId} />
      </WorkspaceGuard>
    </AuthGuard>
  );
}
