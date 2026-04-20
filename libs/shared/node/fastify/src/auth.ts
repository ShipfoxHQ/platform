import type {FastifyReply, FastifyRequest} from 'fastify';
import type {AuthMethod, RouteExport} from './types.js';
import {isRouteGroup} from './types.js';

const authMethods = new Map<string, AuthMethod>();

export function clearAuthMethods(): void {
  authMethods.clear();
}

export function registerAuthMethods(methods: AuthMethod[]): void {
  for (const method of methods) {
    authMethods.set(method.name, method);
  }
}

export function createAuthHook(
  names: string | string[],
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const nameList = Array.isArray(names) ? names : [names];
  const methods = nameList.map((name) => {
    const method = authMethods.get(name);
    if (!method) {
      throw new Error(`Unknown auth method: '${name}'`);
    }
    return method;
  });

  return async (request: FastifyRequest, reply: FastifyReply) => {
    for (const method of methods) {
      await method.authenticate(request, reply);
    }
  };
}

export function validateAuthReferences(routes: RouteExport[]): void {
  for (const route of routes) {
    if (isRouteGroup(route)) {
      validateAuthNames(route.auth);
      validateAuthReferences(route.routes);
    } else {
      validateAuthNames(route.auth);
    }
  }
}

function validateAuthNames(auth: string | string[] | undefined): void {
  if (!auth) return;
  const names = Array.isArray(auth) ? auth : [auth];
  for (const name of names) {
    if (!authMethods.has(name)) {
      throw new Error(`Unknown auth method: '${name}'`);
    }
  }
}
