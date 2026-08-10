import {assertRouteFrame, isRouteFrame, routeFrames} from './route-frame.js';

describe('route frames', () => {
  test('defines the supported shell-owned frames', () => {
    expect(routeFrames).toEqual(['content', 'data', 'focused']);
    expect(routeFrames.every(isRouteFrame)).toBe(true);
  });

  test.each(routeFrames)('accepts the %s frame', (frame) => {
    expect(() => assertRouteFrame({frame}, './route.tsx', '/example')).not.toThrow();
  });

  test.each([
    undefined,
    {},
    {frame: 'full-bleed'},
    {frame: 'content-wide'},
  ])('rejects a route without a supported frame: %j', (staticData) => {
    expect(() => assertRouteFrame(staticData, './route.tsx', '/example')).toThrow(
      'must declare staticData.frame as "content", "data", or "focused".',
    );
  });
});
