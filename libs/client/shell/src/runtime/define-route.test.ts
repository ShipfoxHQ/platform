import {defineRoute, isRouteImpl} from './define-route.js';

describe('isRouteImpl', () => {
  test('accepts implementations created by defineRoute', () => {
    const route = defineRoute({staticData: {frame: 'content'}, component: () => null});

    expect(isRouteImpl(route)).toBe(true);
  });

  test('rejects a default component without a route implementation', () => {
    const component = () => null;

    expect(isRouteImpl(component)).toBe(false);
  });

  test('requires a shell-owned frame in route options', () => {
    // @ts-expect-error Route implementations must declare their shell-owned frame.
    defineRoute({component: () => null});
  });
});
