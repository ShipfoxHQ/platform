import {
  ClientError,
  type RouteDefinition,
  type RouteGroup,
  type RoutePreHandler,
} from '@shipfox/node-fastify';
import {
  adoptAdministrationActorGuard,
  buildUserContext,
  requireAdministrationActor,
  setUserContext,
} from './index.js';

function route(path: string, preHandler?: RouteDefinition['preHandler']): RouteDefinition {
  return {
    method: 'GET',
    path,
    description: `test route ${path}`,
    handler: () => ({ok: true}),
    ...(preHandler === undefined ? {} : {preHandler}),
  };
}

describe('requireAdministrationActor', () => {
  test('rejects an impersonated context with admin-role-required before roles are read', () => {
    const request = {};
    setUserContext(
      request,
      buildUserContext({
        userId: crypto.randomUUID(),
        email: 'target@example.com',
        memberships: [{workspaceId: crypto.randomUUID(), role: 'admin', workspaceStatus: 'active'}],
        impersonatorId: crypto.randomUUID(),
      }),
    );

    const act = () => requireAdministrationActor(request);

    expect(act).toThrow(ClientError);
    expect(act).toThrow(expect.objectContaining({code: 'admin-role-required', status: 403}));
  });

  test('passes an ordinary session through', () => {
    const request = {};
    setUserContext(
      request,
      buildUserContext({userId: crypto.randomUUID(), email: 'user@example.com'}),
    );

    expect(() => requireAdministrationActor(request)).not.toThrow();
  });

  test('passes when no user context exists', () => {
    expect(() => requireAdministrationActor({})).not.toThrow();
  });
});

describe('adoptAdministrationActorGuard', () => {
  test('guards every route in an /admin-prefixed group ahead of existing preHandlers', () => {
    const existingPreHandler = () => Promise.resolve();
    const guardedRoute = route('/lookup', existingPreHandler);
    const [adminGroup] = adoptAdministrationActorGuard([
      {prefix: '/admin/things', routes: [guardedRoute, route('/bootstrap')]},
    ]) as RouteGroup[];

    const [lookup, bootstrap] = adminGroup.routes as RouteDefinition[];
    expect(lookup.preHandler).toHaveLength(2);
    expect(typeof lookup.preHandler?.[0]).toBe('function');
    expect(lookup.preHandler?.[1]).toBe(existingPreHandler);
    expect(bootstrap.preHandler).toHaveLength(1);
    expect(typeof bootstrap.preHandler?.[0]).toBe('function');
  });

  test('guards nested groups under an /admin prefix', () => {
    const leaf = route('/leaf');
    const [group] = adoptAdministrationActorGuard([
      {prefix: '/admin', routes: [{prefix: '/nested', routes: [leaf]}]},
    ]) as RouteGroup[];

    const nested = (group.routes[0] as RouteGroup).routes as RouteDefinition[];
    expect(nested[0]?.preHandler).toHaveLength(1);
  });

  test('guards a root route whose own path is under /admin', () => {
    const guarded = adoptAdministrationActorGuard(route('/admin/things')) as RouteDefinition;

    expect(guarded.preHandler).toHaveLength(1);
    expect(typeof guarded.preHandler?.[0]).toBe('function');
  });

  test('leaves routes outside an /admin prefix untouched', () => {
    const ordinary = route('/things');
    const [group] = adoptAdministrationActorGuard([
      {prefix: '/projects', routes: [ordinary]},
    ]) as RouteGroup[];

    expect((group.routes as RouteDefinition[])[0]).toBe(ordinary);
  });

  test('the adopted preHandler rejects an impersonated request', () => {
    const [group] = adoptAdministrationActorGuard([
      {prefix: '/admin/things', routes: [route('/')]},
    ]) as RouteGroup[];
    const preHandlers = (group.routes as RouteDefinition[])[0]?.preHandler as RoutePreHandler[];

    const markedRequest = {};
    setUserContext(
      markedRequest,
      buildUserContext({
        userId: crypto.randomUUID(),
        email: 'target@example.com',
        impersonatorId: crypto.randomUUID(),
      }),
    );

    const act = () => preHandlers[0]?.(markedRequest as Parameters<RoutePreHandler>[0]);
    expect(act).toThrow(ClientError);
    expect(act).toThrow(expect.objectContaining({code: 'admin-role-required', status: 403}));
  });

  test('accepts a single group and preserves group auth', () => {
    const guarded = adoptAdministrationActorGuard({
      prefix: '/admin/workspaces',
      auth: 'user',
      routes: [route('/')],
    }) as RouteGroup;

    expect(guarded.prefix).toBe('/admin/workspaces');
    expect(guarded.auth).toBe('user');
    expect((guarded.routes as RouteDefinition[])[0]?.preHandler).toHaveLength(1);
  });
});
