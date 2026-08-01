import {
  parseWorkspaceProjectParams,
  useActiveWorkspace,
  useRouteParams,
} from '@shipfox/client-shell/runtime';
import {ProjectCrumb} from '#components/project-crumb.js';
import {resolveProjectSlug, useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export {resolveProjectSlug};

export function useMaybeActiveProject() {
  const workspace = useActiveWorkspace();
  const {projectSlug} = useRouteParams(parseWorkspaceProjectParams);
  const projectsQuery = useProjectsInfiniteQuery(workspace.id);
  return projectsQuery.data?.pages
    .flatMap((page) => page.projects)
    .find((project) => project.slug === projectSlug);
}

export function useActiveProject() {
  const project = useMaybeActiveProject();
  if (!project) throw new Error('No active project is available for this route.');
  return project;
}

export function ProjectBreadcrumb() {
  const workspace = useActiveWorkspace();
  const {projectSlug} = useRouteParams(parseWorkspaceProjectParams);
  const projectsQuery = useProjectsInfiniteQuery(workspace.id);
  const project = projectsQuery.data?.pages
    .flatMap((page) => page.projects)
    .find((candidate) => candidate.slug === projectSlug);
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
