import type {
  AnchorId,
  ClientFeature,
  LayoutContribution,
  RouteContribution,
  RouteParentId,
} from '#contract.js';
import {anchorPaths, validateRoutePathInvariants} from '#runtime/anchor-paths.js';
import {LayoutCompositionError, RouteCompositionError} from './errors.js';
import {normalizeRoutePath} from './normalize-route-path.js';

export interface ComposedLayout extends LayoutContribution {
  featureId: string;
}

export interface ComposedRoute extends RouteContribution {
  featureId: string;
  ownerFeatureId: string;
}

function isShellAnchor(parent: RouteParentId): parent is AnchorId {
  return Object.hasOwn(anchorPaths, parent);
}

function layoutParentPath(
  parent: RouteParentId,
  layouts: ReadonlyMap<string, ComposedLayout>,
): string | undefined {
  if (isShellAnchor(parent)) return anchorPaths[parent];
  return layouts.get(parent)?.path;
}

function resolvedShellAnchor(
  parent: RouteParentId,
  layouts: ReadonlyMap<string, ComposedLayout>,
): AnchorId | undefined {
  let current = parent;
  const visited = new Set<string>();
  while (!isShellAnchor(current)) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    const next = layouts.get(current)?.parent;
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

function validateNestedRoute(
  path: string,
  parent: RouteParentId,
  layouts: ReadonlyMap<string, ComposedLayout>,
  featureId: string,
): void {
  if (resolvedShellAnchor(parent, layouts) === 'root') {
    const protectedAnchor = protectedAnchorForRootPath(path);
    if (protectedAnchor) {
      const [anchor, anchorPath] = protectedAnchor;
      throw new RouteCompositionError(
        path,
        `Route "${path}" in feature "${featureId}" cannot use root parent inside reserved anchor "${anchor}" (${anchorPath}). Use parent "${anchor}".`,
        [featureId],
      );
    }
  }
  const parentPath = layoutParentPath(parent, layouts);
  if (!parentPath) {
    if (isShellAnchor(parent)) return;
    throw new RouteCompositionError(
      path,
      `Route "${path}" in feature "${featureId}" targets missing layout parent "${parent}".`,
      [featureId],
    );
  }
  if (parentPath !== '/' && path !== parentPath && !path.startsWith(`${parentPath}/`)) {
    const parentKind = isShellAnchor(parent) ? 'anchor' : 'layout';
    throw new RouteCompositionError(
      path,
      `Route "${path}" must be nested under ${parentKind} "${parent}" (${parentPath}).`,
      [featureId],
    );
  }
}

const anchorPathValues: ReadonlySet<string> = new Set(Object.values(anchorPaths));
const protectedAnchorPaths = Object.entries(anchorPaths)
  .filter(([anchor]) => anchor !== 'root')
  .sort(([, leftPath], [, rightPath]) => rightPath.length - leftPath.length) as Array<
  [Exclude<AnchorId, 'root'>, string]
>;

function protectedAnchorForRootPath(
  path: string,
): readonly [Exclude<AnchorId, 'root'>, string] | undefined {
  return protectedAnchorPaths.find(
    ([, anchorPath]) => path === anchorPath || path.startsWith(`${anchorPath}/`),
  );
}

function validateLayoutParents(layouts: readonly ComposedLayout[]): Map<string, ComposedLayout> {
  const byId = new Map<string, ComposedLayout>();
  for (const layout of layouts) {
    if (isShellAnchor(layout.id)) {
      throw new LayoutCompositionError(
        layout.id,
        `Layout id "${layout.id}" in feature "${layout.featureId}" is reserved by the shell.`,
        [layout.featureId],
      );
    }
    if (anchorPathValues.has(layout.path)) {
      throw new LayoutCompositionError(
        layout.id,
        `Layout "${layout.id}" in feature "${layout.featureId}" targets path "${layout.path}" which is reserved by a shell anchor.`,
        [layout.featureId],
      );
    }
    const existing = byId.get(layout.id);
    if (existing) {
      throw new LayoutCompositionError(
        layout.id,
        `Layout id "${layout.id}" is contributed by both features "${existing.featureId}" and "${layout.featureId}".`,
        [existing.featureId, layout.featureId],
      );
    }
    byId.set(layout.id, layout);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(layout: ComposedLayout): void {
    if (visited.has(layout.id) || isShellAnchor(layout.parent)) return;
    if (visiting.has(layout.id)) {
      throw new LayoutCompositionError(
        layout.id,
        `Layout "${layout.id}" in feature "${layout.featureId}" has a cyclic parent reference.`,
        [layout.featureId],
      );
    }
    const parent = byId.get(layout.parent);
    if (!parent) {
      throw new LayoutCompositionError(
        layout.id,
        `Layout "${layout.id}" in feature "${layout.featureId}" targets missing layout parent "${layout.parent}".`,
        [layout.featureId],
      );
    }
    visiting.add(layout.id);
    visit(parent);
    visiting.delete(layout.id);
    visited.add(layout.id);
  }

  for (const layout of layouts) visit(layout);
  return byId;
}

export function composeLayouts(features: readonly ClientFeature[]): ComposedLayout[] {
  const layouts = features.flatMap((feature) =>
    (feature.layouts ?? []).map((layout) => ({
      ...layout,
      path: normalizeRoutePath(layout.path),
      featureId: feature.id,
    })),
  );
  const layoutById = validateLayoutParents(layouts);
  for (const layout of layouts) {
    validateRoutePathInvariants(layout.path);
    validateNestedRoute(layout.path, layout.parent, layoutById, layout.featureId);
  }
  return layouts;
}

export function composeRoutes(
  features: readonly ClientFeature[],
  providedLayouts?: readonly ComposedLayout[],
): ComposedRoute[] {
  const layouts = providedLayouts ? [...providedLayouts] : composeLayouts(features);
  const layoutById = validateLayoutParents(layouts);
  const layoutPaths = indexLayoutPaths(layouts);
  const routes = new Map<string, ComposedRoute>();
  for (const feature of features) {
    for (const contribution of feature.routes ?? []) {
      addRouteContribution(feature, contribution, layoutPaths, routes);
    }
  }

  for (const layout of layouts) {
    validateNestedRoute(layout.path, layout.parent, layoutById, layout.featureId);
  }
  for (const route of routes.values()) {
    validateRoutePathInvariants(route.path);
    validateNestedRoute(route.path, route.parent, layoutById, route.featureId);
  }
  return [...routes.values()];
}

function indexLayoutPaths(layouts: readonly ComposedLayout[]): Map<string, ComposedLayout> {
  const layoutPaths = new Map<string, ComposedLayout>();
  for (const layout of layouts) {
    validateRoutePathInvariants(layout.path);
    const existing = layoutPaths.get(layout.path);
    if (existing) {
      throw new RouteCompositionError(
        layout.path,
        `Route "${layout.path}" is contributed by both features "${existing.featureId}" and "${layout.featureId}".`,
        [existing.featureId, layout.featureId],
      );
    }
    layoutPaths.set(layout.path, layout);
  }
  return layoutPaths;
}

function addRouteContribution(
  feature: ClientFeature,
  contribution: NonNullable<ClientFeature['routes']>[number],
  layoutPaths: ReadonlyMap<string, ComposedLayout>,
  routes: Map<string, ComposedRoute>,
): void {
  const normalizedContribution = {...contribution, path: normalizeRoutePath(contribution.path)};
  const layoutAtPath = layoutPaths.get(normalizedContribution.path);
  if (layoutAtPath) {
    throwRouteLayoutConflict(feature.id, normalizedContribution, layoutAtPath);
  }
  const existing = routes.get(normalizedContribution.path);
  if (!existing) {
    if (normalizedContribution.override) {
      throw new RouteCompositionError(
        normalizedContribution.path,
        `Route override for "${normalizedContribution.path}" from feature "${feature.id}" has no route to replace.`,
        [feature.id],
      );
    }
    routes.set(normalizedContribution.path, {
      ...normalizedContribution,
      featureId: feature.id,
      ownerFeatureId: feature.id,
    });
    return;
  }
  validateRouteOverride(feature.id, normalizedContribution, existing);
  routes.set(normalizedContribution.path, {
    ...normalizedContribution,
    featureId: feature.id,
    ownerFeatureId: existing.ownerFeatureId,
  });
}

function throwRouteLayoutConflict(
  featureId: string,
  contribution: NonNullable<ClientFeature['routes']>[number],
  layout: ComposedLayout,
): never {
  const message = contribution.override
    ? `Route override for "${contribution.path}" from feature "${featureId}" cannot replace layout "${layout.id}" contributed by feature "${layout.featureId}".`
    : `Route "${contribution.path}" from feature "${featureId}" conflicts with layout "${layout.id}" contributed by feature "${layout.featureId}". Routes cannot replace layouts.`;
  throw new RouteCompositionError(contribution.path, message, [layout.featureId, featureId]);
}

function validateRouteOverride(
  featureId: string,
  contribution: NonNullable<ClientFeature['routes']>[number],
  existing: ComposedRoute,
): void {
  if (!contribution.override) {
    throw new RouteCompositionError(
      contribution.path,
      `Route "${contribution.path}" is contributed by both features "${existing.featureId}" and "${featureId}". Set override: true to replace it explicitly.`,
      [existing.featureId, featureId],
    );
  }
  if (existing.override) {
    throw new RouteCompositionError(
      contribution.path,
      `Route "${contribution.path}" has competing overrides from features "${existing.featureId}" and "${featureId}".`,
      [existing.featureId, featureId],
    );
  }
  if (existing.parent !== contribution.parent) {
    throw new RouteCompositionError(
      contribution.path,
      `Route override for "${contribution.path}" from feature "${featureId}" cannot change anchor from "${existing.parent}" in feature "${existing.featureId}" to "${contribution.parent}".`,
      [existing.featureId, featureId],
    );
  }
}
