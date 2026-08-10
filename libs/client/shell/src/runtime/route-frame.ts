export const routeFrames = ['content', 'data', 'focused'] as const;

export type RouteFrame = (typeof routeFrames)[number];

export function isRouteFrame(value: unknown): value is RouteFrame {
  return typeof value === 'string' && (routeFrames as readonly string[]).includes(value);
}

export function assertRouteFrame(
  staticData: unknown,
  impl: string,
  path: string,
): asserts staticData is {frame: RouteFrame} {
  const frame =
    typeof staticData === 'object' && staticData !== null && 'frame' in staticData
      ? staticData.frame
      : undefined;
  if (isRouteFrame(frame)) return;

  throw new Error(
    `Route implementation "${impl}" for "${path}" must declare staticData.frame as "content", "data", or "focused".`,
  );
}
