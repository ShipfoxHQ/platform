import {isRouteImpl, type RouteImpl} from './define-route.js';

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

export function assertRouteImplFrame(
  routeImpl: unknown,
  impl: string,
  path: string,
): asserts routeImpl is RouteImpl {
  if (!isRouteImpl(routeImpl)) {
    throw new TypeError(
      `Route implementation "${impl}" for "${path}" must export default defineRoute(...).`,
    );
  }
  assertRouteFrame(routeImpl.options.staticData, impl, path);
}
