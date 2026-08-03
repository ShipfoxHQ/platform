export interface ProjectRouteParams {
  workspaceSlug: string;
  projectSlug: string;
}

export function projectRouteParams(input: Record<string, unknown>): ProjectRouteParams {
  const workspaceSlug = stringParam(input.workspaceSlug);
  const projectSlug = stringParam(input.projectSlug);
  if (!workspaceSlug || !projectSlug)
    throw new Error('Project route is missing required path parameters.');
  return {workspaceSlug, projectSlug};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
