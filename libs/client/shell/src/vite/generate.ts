import type {ComposedLayout, ComposedRoute} from '#compose/compose-routes.js';
import type {NavTabEntry, RouteParentId, SettingsSectionEntry} from '#contract.js';
import {routePathForParent} from '#runtime/anchor-paths.js';

export interface GenerateAppModuleOptions {
  layouts?: readonly ComposedLayout[];
  routes: readonly ComposedRoute[];
  navigation: readonly NavTabEntry[];
  settingsSections: readonly SettingsSectionEntry[];
}

function literal(value: unknown): string {
  return JSON.stringify(value, undefined, 2);
}

function indentedLiteral(value: unknown, indentation: number): string {
  return literal(value).replaceAll('\n', `\n${' '.repeat(indentation)}`);
}

function isShellAnchor(parent: RouteParentId): boolean {
  return [
    'root',
    'workspaceLayout',
    'projectLayout',
    'workspaceSettings',
    'projectSettings',
  ].includes(parent);
}

function orderedLayouts(layouts: readonly ComposedLayout[]): ComposedLayout[] {
  const byId = new Map(layouts.map((layout) => [layout.id, layout]));
  const ordered: ComposedLayout[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(layout: ComposedLayout): void {
    if (visited.has(layout.id)) return;
    if (!isShellAnchor(layout.parent)) {
      if (visiting.has(layout.id)) {
        throw new Error(`Layout "${layout.id}" has a cyclic parent reference.`);
      }
      const parent = byId.get(layout.parent);
      if (!parent) {
        throw new Error(`Layout "${layout.id}" targets missing layout parent "${layout.parent}".`);
      }
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

function routeNames(routes: readonly ComposedRoute[], parent: RouteParentId): string {
  return routes
    .map((route, index) => ({route, index}))
    .filter(({route}) => route.parent === parent)
    .map(({index}) => `route${index}`)
    .join(', ');
}

function layoutTreeNames(layouts: readonly ComposedLayout[], parent: RouteParentId): string[] {
  return layouts
    .map((layout, index) => ({layout, index}))
    .filter(({layout}) => layout.parent === parent)
    .map(({index}) => `layout${index}Tree`);
}

function parentExpression(
  parent: RouteParentId,
  layoutIndexes: ReadonlyMap<string, number>,
): string {
  if (parent === 'root') return 'skeleton.rootRoute';
  if (isShellAnchor(parent)) return `skeleton.${parent}`;
  const index = layoutIndexes.get(parent);
  if (index === undefined) throw new Error(`Missing generated layout parent "${parent}".`);
  return `layout${index}`;
}

export function generateAppModule({
  layouts = [],
  routes,
  navigation,
  settingsSections,
}: GenerateAppModuleOptions): string {
  const generatedLayouts = orderedLayouts(layouts);
  const layoutIndexes = new Map(generatedLayouts.map((layout, index) => [layout.id, index]));
  const layoutPaths = new Map(generatedLayouts.map((layout) => [layout.id, layout.path]));
  const imports = [
    ...generatedLayouts.map(
      (layout, index) => `import * as layout${index}Module from ${literal(layout.impl)};`,
    ),
    ...routes.map((route, index) => `import * as route${index}Module from ${literal(route.impl)};`),
  ].join('\n');
  const layoutDeclarations = generatedLayouts
    .map(
      (layout, index) => `const layout${index} = createRoute({
  getParentRoute: () => ${parentExpression(layout.parent, layoutIndexes)},
  path: ${literal(routePathForParent(layout.parent, layout.path, layoutPaths))},
  ...routeOptions(layout${index}Module.default, ${literal(layout.impl)}, ${literal(layout.path)}),
});`,
    )
    .join('\n\n');
  const routeDeclarations = routes
    .map(
      (route, index) => `const route${index} = createRoute({
  getParentRoute: () => ${parentExpression(route.parent, layoutIndexes)},
  path: ${literal(routePathForParent(route.parent, route.path, layoutPaths))},
  ...routeOptions(route${index}Module.default, ${literal(route.impl)}, ${literal(route.path)}),
});`,
    )
    .join('\n\n');
  const layoutTreeDeclarations = generatedLayouts
    .map((layout, index) => ({layout, index}))
    .reverse()
    .map(({layout, index}) => {
      const routeChildren = routeNames(routes, layout.id);
      const children = [routeChildren, ...layoutTreeNames(generatedLayouts, layout.id)]
        .filter(Boolean)
        .join(',\n  ');
      return `const layout${index}Tree = layout${index}.addChildren([${children}]);`;
    })
    .join('\n');
  const declarations = [layoutDeclarations, routeDeclarations, layoutTreeDeclarations]
    .filter(Boolean)
    .join('\n\n');
  const rootRoutes = routeNames(routes, 'root');
  const rootChildren = [rootRoutes, ...layoutTreeNames(generatedLayouts, 'root'), 'workspaceLayout']
    .filter(Boolean)
    .join(',\n  ');
  const projectChildren = [
    routeNames(routes, 'projectLayout'),
    ...layoutTreeNames(generatedLayouts, 'projectLayout'),
    'projectSettings',
  ]
    .filter(Boolean)
    .join(',\n  ');
  const workspaceSettingsChildren = [
    routeNames(routes, 'workspaceSettings'),
    ...layoutTreeNames(generatedLayouts, 'workspaceSettings'),
  ]
    .filter(Boolean)
    .join(',\n  ');
  const projectSettingsChildren = [
    routeNames(routes, 'projectSettings'),
    ...layoutTreeNames(generatedLayouts, 'projectSettings'),
  ]
    .filter(Boolean)
    .join(',\n  ');
  const workspaceChildren = [
    routeNames(routes, 'workspaceLayout'),
    ...layoutTreeNames(generatedLayouts, 'workspaceLayout'),
    'projectLayout',
    'workspaceSettings',
  ]
    .filter(Boolean)
    .join(',\n  ');

  return `// GENERATED by @shipfox/client-shell/vite. Do not edit.
// biome-ignore-all format: generated code has stable, reviewable output.
// biome-ignore-all assist/source/organizeImports: generated imports follow route order.
import {createRoute, createRouter} from '@tanstack/react-router';
import {buildAnchorSkeleton, isRouteImpl, type RouteImpl, type RouterContext} from '@shipfox/client-shell/runtime';
${imports}

function routeOptions<T extends RouteImpl>(routeImpl: T, impl: string, path: string): T['options'] {
  if (!isRouteImpl(routeImpl)) {
    throw new TypeError(\`Route implementation "\${impl}" for "\${path}" must export default defineRoute(...).\`);
  }
  return routeImpl.options;
}

const skeleton = buildAnchorSkeleton({
  navigation: ${indentedLiteral(navigation, 2)},
  settingsSections: ${indentedLiteral(settingsSections, 2)},
});

${declarations}

const projectSettings = skeleton.projectSettings.addChildren([${projectSettingsChildren}]);
const projectLayout = skeleton.projectLayout.addChildren([${projectChildren}]);
const workspaceSettings = skeleton.workspaceSettings.addChildren([${workspaceSettingsChildren}]);
const workspaceLayout = skeleton.workspaceLayout.addChildren([
  ${workspaceChildren},
]);

export const routeTree = skeleton.rootRoute.addChildren([
  ${rootChildren},
]);

export const router = createRouter({
  routeTree,
  context: {auth: undefined, queryClient: undefined} satisfies RouterContext,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
`;
}
