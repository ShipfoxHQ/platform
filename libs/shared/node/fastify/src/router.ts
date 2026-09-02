import type {FastifyInstance} from 'fastify';
import {createAuthHook} from './auth.js';
import type {RouteDefinition, RouteExport, RouteGroup, RoutePreHandler} from './types.js';
import {isRouteGroup} from './types.js';

type FastifyRouteConfig = Parameters<FastifyInstance['route']>[0];
type FastifyPreHandler = NonNullable<FastifyRouteConfig['preHandler']>;
type FastifyOnRequest = NonNullable<FastifyRouteConfig['onRequest']>;

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

  const routeConfig: FastifyRouteConfig = {
    method: route.method,
    url: route.path,
    handler: route.handler,
  };

  routeConfig.schema = {...route.schema, description: route.description};
  if (route.errorHandler) routeConfig.errorHandler = route.errorHandler;
  const authHook = effectiveAuth === undefined ? undefined : createAuthHook(effectiveAuth);
  if (route.preAuth !== undefined) {
    const preAuthHook = normalizeOnRequest(route.preAuth);
    routeConfig.onRequest =
      authHook === undefined ? preAuthHook : appendOnRequest(preAuthHook, authHook);
  } else if (authHook !== undefined) {
    routeConfig.onRequest = authHook;
  }
  if (route.preHandler) {
    routeConfig.preHandler = normalizePreHandler(route.preHandler);
  }
  if (route.options?.bodyLimit !== undefined) routeConfig.bodyLimit = route.options.bodyLimit;
  if (route.options?.logLevel !== undefined) routeConfig.logLevel = route.options.logLevel;
  if (route.options?.handlerTimeout !== undefined)
    routeConfig.handlerTimeout = route.options.handlerTimeout;

  app.route(routeConfig);
}

function normalizePreHandler(preHandler: RoutePreHandler | RoutePreHandler[]): FastifyPreHandler {
  if (Array.isArray(preHandler)) {
    return preHandler.map((handler) => async (request, reply) => {
      await handler(request, reply);
    }) as FastifyPreHandler;
  }

  return (async (request, reply) => {
    await preHandler(request, reply);
  }) as FastifyPreHandler;
}

function normalizeOnRequest(preAuth: RoutePreHandler | RoutePreHandler[]): FastifyOnRequest {
  return normalizePreHandler(preAuth) as unknown as FastifyOnRequest;
}

function appendOnRequest(preAuth: FastifyOnRequest, authHook: FastifyOnRequest): FastifyOnRequest {
  return [
    ...(Array.isArray(preAuth) ? preAuth : [preAuth]),
    ...(Array.isArray(authHook) ? authHook : [authHook]),
  ] as FastifyOnRequest;
}
