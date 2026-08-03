export function modelProviderRouteParams(input: Record<string, unknown>): {workspaceSlug: string} {
  const workspaceSlug = stringParam(input.workspaceSlug);
  if (!workspaceSlug)
    throw new Error('Model provider route is missing the workspace path parameter.');
  return {workspaceSlug};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
