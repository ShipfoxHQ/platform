import {
  parseWorkspaceProjectParams,
  useActiveWorkspace,
  useRouteParams,
} from '@shipfox/client-shell/runtime';
import {ProjectCrumb} from '#components/project-crumb.js';
import {resolveProjectSlug, useProjectSlugQuery} from '#hooks/api/projects.js';

export {resolveProjectSlug};

export function useMaybeActiveProjectQuery() {
  const workspace = useActiveWorkspace();
  const {projectSlug} = useRouteParams(parseWorkspaceProjectParams);
  return useProjectSlugQuery(workspace.id, projectSlug);
}

export function useMaybeActiveProject() {
  return useMaybeActiveProjectQuery().data;
}

export function useActiveProject() {
  const project = useMaybeActiveProject();
  if (!project) throw new Error('No active project is available for this route.');
  return project;
}

export function ProjectBreadcrumb() {
  const workspace = useActiveWorkspace();
  const project = useMaybeActiveProject();
  return (
    <ProjectCrumb
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
      projectId={project?.id}
      projectSlug={project?.slug}
      projectName={project?.name}
    />
  );
}
