import type {ComponentType} from 'react';
import type {RouteFrame} from './route-frame.js';

export interface RouteStaticData extends Record<string, unknown> {
  frame: RouteFrame;
}

export interface RouteImplOptions {
  component?: ComponentType;
  loader?: unknown;
  validateSearch?: unknown;
  beforeLoad?: unknown;
  staticData: RouteStaticData;
  pendingComponent?: ComponentType;
  errorComponent?: ComponentType;
}

const routeImplBrand = Symbol('routeImpl');

export interface RouteImpl<O extends RouteImplOptions = RouteImplOptions> {
  readonly options: O;
  readonly [routeImplBrand]: true;
}

export function defineRoute<const O extends RouteImplOptions>(options: O): RouteImpl<O> {
  return {options, [routeImplBrand]: true};
}

export function isRouteImpl(value: unknown): value is RouteImpl {
  return (
    typeof value === 'object' &&
    value !== null &&
    routeImplBrand in value &&
    'options' in value &&
    typeof value.options === 'object' &&
    value.options !== null
  );
}
