import {AuthGuard, WorkspaceGuard} from '@shipfox/client-auth';
import {CreateProjectPage} from '@shipfox/client-projects';
import {createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute('/projects/new')({
  component: () => (
    <AuthGuard>
      <WorkspaceGuard>
        <CreateProjectPage />
      </WorkspaceGuard>
    </AuthGuard>
  ),
});
