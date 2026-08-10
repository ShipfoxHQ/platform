import {type AnyRoute, createRoute} from '@tanstack/react-router';
import type {ComposedLayout, ComposedRoute} from '#compose/compose-routes.js';
import type {RouteParentId} from '#contract.js';
import {routePathForParent} from '#runtime/anchor-paths.js';
import {buildAnchorSkeleton} from '#runtime/anchors.js';
import type {RouteImpl} from '#runtime/define-route.js';
import {assertRouteImplFrame} from '#runtime/route-frame.js';

export type ResolveRouteImpl = (specifier: string) => RouteImpl | Promise<RouteImpl>;

const shellAnchors = [
  'root',
  'workspaceLayout',
  'projectLayout',
  'workspaceSettings',
  'projectSettings',
] as const;

function isShellAnchor(parent: RouteParentId): parent is (typeof shellAnchors)[number] {
  return shellAnchors.includes(parent as (typeof shellAnchors)[number]);
}

function orderLayouts(layouts: readonly ComposedLayout[]): ComposedLayout[] {
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const ordered: ComposedLayout[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(layout: ComposedLayout): void {
    if (visited.has(layout.id)) return;
    if (!isShellAnchor(layout.parent)) {
      if (visiting.has(layout.id))
        throw new Error(`Layout "${layout.id}" has a cyclic parent reference.`);
      const parent = byId.get(layout.parent);
      if (!parent)
        throw new Error(`Layout "${layout.id}" targets missing parent "${layout.parent}".`);
      visiting.add(layout.id);
      visit(parent);
      visiting.delete(layout.id);
    }
    visited.add(layout.id);
    ordered.push(layout);
  }

  for (const layout of layouts) visit(layout);
  return ordered;
}

export async function assembleRouteTree(
  routes: readonly ComposedRoute[],
  options: {
    layouts?: readonly ComposedLayout[];
    resolveImpl: ResolveRouteImpl;
    navigation: Parameters<typeof buildAnchorSkeleton>[0]['navigation'];
    settingsSections: Parameters<typeof buildAnchorSkeleton>[0]['settingsSections'];
  },
) {
  const layouts = orderLayouts(options.layouts ?? []);
  const layoutPaths = new Map(layouts.map((layout) => [layout.id, layout.path]));
  const skeleton = buildAnchorSkeleton(options);
  const layoutRoutes = new Map<string, AnyRoute>();

  for (const layout of layouts) {
    const impl = await options.resolveImpl(layout.impl);
    assertRouteImplFrame(impl, layout.impl, layout.path);
    const parentRoute = isShellAnchor(layout.parent)
      ? skeleton.anchors[layout.parent]
      : layoutRoutes.get(layout.parent);
    if (!parentRoute) throw new Error(`Missing layout parent "${layout.parent}".`);
    layoutRoutes.set(
      layout.id,
      createRoute({
        getParentRoute: () => parentRoute as never,
        path: routePathForParent(layout.parent, layout.path, layoutPaths),
        ...impl.options,
      } as never) as unknown as AnyRoute,
    );
  }

  const routeEntries: Array<{parent: RouteParentId; route: AnyRoute}> = await Promise.all(
    routes.map(async (route) => {
      const impl = await options.resolveImpl(route.impl);
      assertRouteImplFrame(impl, route.impl, route.path);
      const parentRoute = isShellAnchor(route.parent)
        ? skeleton.anchors[route.parent]
        : layoutRoutes.get(route.parent);
      if (!parentRoute) throw new Error(`Missing route parent "${route.parent}".`);
      return {
        parent: route.parent,
        route: createRoute({
          getParentRoute: () => parentRoute as never,
          path: routePathForParent(route.parent, route.path, layoutPaths),
          ...impl.options,
        } as never) as unknown as AnyRoute,
      };
    }),
  );

  const routeChildrenFor = (parent: RouteParentId) =>
    routeEntries.filter((entry) => entry.parent === parent).map((entry) => entry.route);
  const layoutTrees = new Map<string, AnyRoute>();
  function layoutTree(layoutId: string): AnyRoute {
    const existing = layoutTrees.get(layoutId);
    if (existing) return existing;
    const layout = layouts.find((candidate) => candidate.id === layoutId);
    const route = layoutRoutes.get(layoutId);
    if (!layout || !route) throw new Error(`Missing layout "${layoutId}".`);
    const children = [
      ...routeChildrenFor(layoutId),
      ...layouts
        .filter((candidate) => candidate.parent === layoutId)
        .map((candidate) => layoutTree(candidate.id)),
    ];
    const tree = route.addChildren(children as never) as unknown as AnyRoute;
    layoutTrees.set(layoutId, tree);
    return tree;
  }

  const childrenFor = (parent: RouteParentId) => [
    ...routeChildrenFor(parent),
    ...layouts.filter((layout) => layout.parent === parent).map((layout) => layoutTree(layout.id)),
  ];
  const projectSettings = skeleton.projectSettings.addChildren(
    childrenFor('projectSettings') as never,
  );
  const projectLayout = skeleton.projectLayout.addChildren([
    ...childrenFor('projectLayout'),
    projectSettings,
  ] as never);
  const workspaceSettings = skeleton.workspaceSettings.addChildren(
    childrenFor('workspaceSettings') as never,
  );
  const workspaceLayout = skeleton.workspaceLayout.addChildren([
    ...childrenFor('workspaceLayout'),
    projectLayout,
    workspaceSettings,
  ] as never);
  return skeleton.rootRoute.addChildren([
    ...childrenFor('root'),
    workspaceLayout,
  ] as never) as unknown as typeof skeleton.rootRoute;
}
