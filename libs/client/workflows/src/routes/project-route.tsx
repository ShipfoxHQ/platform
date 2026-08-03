import {type Project, useMaybeActiveProjectQuery} from '@shipfox/client-projects';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import type {ReactNode} from 'react';

export function ProjectRoute({children}: {children: (project: Project) => ReactNode}) {
  const projectQuery = useMaybeActiveProjectQuery();

  if (projectQuery.isPending) return <FullPageLoader />;
  if (projectQuery.isError && projectQuery.data === undefined) {
    return <QueryLoadError query={projectQuery} subject="project" />;
  }
  if (!projectQuery.data) {
    return (
      <EmptyState
        icon="errorWarningLine"
        title="Project not found"
        description="This project doesn't exist, or you don't have access to it."
      />
    );
  }

  return children(projectQuery.data);
}
