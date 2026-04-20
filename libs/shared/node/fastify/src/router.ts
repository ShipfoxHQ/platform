import type {FastifyInstance} from 'fastify';
import {createAuthHook} from './auth.js';
import type {RouteDefinition, RouteExport, RouteGroup} from './types.js';
import {isRouteGroup} from './types.js';

export function mountRoutes({
  app,
  routes,
  parentAuth,
}: {
  app: FastifyInstance;
  routes: RouteExport[];
  parentAuth?: string | string[];
}): void {
  for (const route of routes) {
    if (isRouteGroup(route)) {
      mountGroup(app, route, parentAuth);
    } else {
      mountRoute(app, route, parentAuth);
    }
  }
}

function mountGroup(app: FastifyInstance, group: RouteGroup, parentAuth?: string | string[]): void {
  const effectiveAuth = group.auth ?? parentAuth;

  app.register(
    async (scope) => {
      if (group.plugins) {
        for (const plugin of group.plugins) {
          await scope.register(plugin);
        }
      }

      for (const route of group.routes) {
        if (isRouteGroup(route)) {
          mountGroup(scope, route, effectiveAuth);
        } else {
          mountRoute(scope, route, effectiveAuth);
        }
      }
    },
    {prefix: group.prefix},
  );
}

function mountRoute(
  app: FastifyInstance,
  route: RouteDefinition,
  parentAuth?: string | string[],
): void {
  const effectiveAuth = route.auth ?? parentAuth;

  const routeConfig: Parameters<FastifyInstance['route']>[0] = {
    method: route.method,
    url: route.path,
    handler: route.handler,
  };

  routeConfig.schema = {...route.schema, description: route.description};
  if (route.errorHandler) routeConfig.errorHandler = route.errorHandler;
  if (effectiveAuth) routeConfig.onRequest = createAuthHook(effectiveAuth);
  if (route.options?.bodyLimit !== undefined) routeConfig.bodyLimit = route.options.bodyLimit;
  if (route.options?.logLevel !== undefined) routeConfig.logLevel = route.options.logLevel;
  if (route.options?.handlerTimeout !== undefined)
    routeConfig.handlerTimeout = route.options.handlerTimeout;

  app.route(routeConfig);
}
