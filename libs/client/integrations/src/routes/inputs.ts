export function connectionDetailsRouteParams(input: Record<string, unknown>): {
  workspaceSlug: string;
  connectionSlug: string;
} {
  const workspaceSlug = stringParam(input.workspaceSlug);
  const connectionSlug = stringParam(input.connectionSlug);
  if (!workspaceSlug || !connectionSlug) {
    throw new Error('Connection details route is missing required path parameters.');
  }
  return {workspaceSlug, connectionSlug};
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
