import type {ClientFeature, NavTabEntry, RouteParentId} from '#contract.js';
import {NavCompositionError, SettingsCompositionError} from './errors.js';
import {normalizeRoutePath} from './normalize-route-path.js';

interface RouteReference {
  path: string;
  featureId?: string;
  ownerFeatureId?: string;
  parent?: RouteParentId;
}

type RouteReferences = Iterable<string | RouteReference>;

interface LayoutReference {
  id: string;
  path: string;
  featureId?: string;
  parent?: RouteParentId;
}

function routeOwners(routeReferences: RouteReferences): Map<string, string | undefined> {
  const owners = new Map<string, string | undefined>();
  for (const route of routeReferences) {
    const path = typeof route === 'string' ? route : route.path;
    owners.set(
      normalizeRoutePath(path),
      typeof route === 'string' ? undefined : (route.ownerFeatureId ?? route.featureId),
    );
  }
  return owners;
}

function hasExplicitCoordinator(feature: ClientFeature): boolean {
  return feature.coordinator === feature.id;
}

function validateRoleMetadata(entry: NavTabEntry, feature: ClientFeature): void {
  const rawEntry = entry as NavTabEntry & {minimumRole?: unknown};
  const hasMinimumRole = Object.hasOwn(rawEntry, 'minimumRole');
  if (entry.scope !== 'layout') {
    if (hasMinimumRole) {
      throw new NavCompositionError(
        entry.id,
        `Navigation entry "${entry.id}" in feature "${feature.id}" has minimum role metadata but is not layout-scoped.`,
        [feature.id],
      );
    }
    return;
  }
  if (hasMinimumRole) {
    if (typeof rawEntry.minimumRole !== 'string' || rawEntry.minimumRole.trim() === '') {
      throw new NavCompositionError(
        entry.id,
        `Navigation entry "${entry.id}" in feature "${feature.id}" has invalid minimum role metadata. Expected a non-empty string.`,
        [feature.id],
      );
    }
  }
}

export function validateNavigation(
  features: readonly ClientFeature[],
  routeReferences: RouteReferences,
  layoutReferences: readonly LayoutReference[] = [],
): void {
  const routeReferencesWithLayouts: Array<string | RouteReference> = [...routeReferences];
  for (const layout of layoutReferences) {
    routeReferencesWithLayouts.push({
      path: layout.path,
      ...(layout.featureId ? {featureId: layout.featureId, ownerFeatureId: layout.featureId} : {}),
      ...(layout.parent ? {parent: layout.parent} : {}),
    });
  }
  const routes = routeOwners(routeReferencesWithLayouts);
  const layouts = new Map(layoutReferences.map((layout) => [layout.id, layout]));
  const entries = new Map<string, string>();
  for (const feature of features) {
    for (const entry of feature.navigation ?? []) {
      validateNavigationEntry({
        entry,
        feature,
        entries,
        routes,
        layouts,
        routeReferences: routeReferencesWithLayouts,
      });
    }
  }
}

function validateNavigationEntry({
  entry,
  feature,
  entries,
  routes,
  layouts,
  routeReferences,
}: {
  entry: NavTabEntry;
  feature: ClientFeature;
  entries: Map<string, string>;
  routes: ReadonlyMap<string, string | undefined>;
  layouts: ReadonlyMap<string, LayoutReference>;
  routeReferences: RouteReferences;
}): void {
  validateRoleMetadata(entry, feature);
  validateUniqueNavigationEntry(entry, feature, entries);
  const target = normalizeRoutePath(entry.to);
  const routeOwner = routes.get(target);
  if (routeOwner === undefined && !routes.has(target)) {
    throw new NavCompositionError(
      entry.id,
      `Navigation entry "${entry.id}" in feature "${feature.id}" targets missing route "${target}".`,
      [feature.id],
    );
  }
  if (entry.scope === 'layout') {
    validateLayoutNavigationEntry(entry, feature, target, routeReferences, layouts);
  } else {
    validateCrossFeatureNavigationEntry(entry, feature, target, routeOwner);
  }
  entries.set(entry.id, feature.id);
}

function validateUniqueNavigationEntry(
  entry: NavTabEntry,
  feature: ClientFeature,
  entries: ReadonlyMap<string, string>,
): void {
  const existingFeatureId = entries.get(entry.id);
  if (!existingFeatureId) return;
  throw new NavCompositionError(
    entry.id,
    `Navigation entry "${entry.id}" is contributed by both features "${existingFeatureId}" and "${feature.id}".`,
    [existingFeatureId, feature.id],
  );
}

function validateLayoutNavigationEntry(
  entry: Extract<NavTabEntry, {scope: 'layout'}>,
  feature: ClientFeature,
  target: string,
  routeReferences: RouteReferences,
  layouts: ReadonlyMap<string, LayoutReference>,
): void {
  if (typeof entry.layout !== 'string' || entry.layout.trim() === '') {
    throw new NavCompositionError(
      entry.id,
      `Navigation entry "${entry.id}" in feature "${feature.id}" has invalid layout metadata. Expected a non-empty layout id.`,
      [feature.id],
    );
  }
  const layout = layouts.get(entry.layout);
  if (!layout) {
    throw new NavCompositionError(
      entry.id,
      `Navigation entry "${entry.id}" in feature "${feature.id}" targets missing layout "${entry.layout}".`,
      [feature.id],
    );
  }
  const route = routeReferencesForPath(routeReferences, target);
  const isLayoutRoot = route?.path === layout.path;
  const isLayoutDescendant = routeDescendsFromLayout(route, entry.layout, layouts);
  if (!isLayoutRoot && !isLayoutDescendant) {
    throw new NavCompositionError(
      entry.id,
      `Navigation entry "${entry.id}" in feature "${feature.id}" targets route "${target}" outside layout "${entry.layout}".`,
      [feature.id],
    );
  }
}

function validateCrossFeatureNavigationEntry(
  entry: NavTabEntry,
  feature: ClientFeature,
  target: string,
  routeOwner: string | undefined,
): void {
  if (!routeOwner || routeOwner === feature.id || hasExplicitCoordinator(feature)) return;
  throw new NavCompositionError(
    entry.id,
    `Navigation entry "${entry.id}" in feature "${feature.id}" targets route "${target}" owned by feature "${routeOwner}". Declare coordinator: "${feature.id}" to own this cross-feature contribution.`,
    [routeOwner, feature.id],
  );
}

function routeReferencesForPath(
  routeReferences: RouteReferences,
  path: string,
): RouteReference | undefined {
  for (const route of routeReferences) {
    const reference = typeof route === 'string' ? {path: route} : route;
    if (normalizeRoutePath(reference.path) === path) return reference;
  }
  return undefined;
}

function routeDescendsFromLayout(
  route: RouteReference | undefined,
  layoutId: string,
  layouts: ReadonlyMap<string, LayoutReference>,
): boolean {
  const visited = new Set<string>();
  let parent = route?.parent;
  while (parent && !visited.has(parent)) {
    if (parent === layoutId) return true;
    visited.add(parent);
    parent = layouts.get(parent)?.parent;
  }
  return false;
}

export function validateSettingsSections(
  features: readonly ClientFeature[],
  routeReferences: RouteReferences,
): void {
  const routes = routeOwners(routeReferences);
  const sections = new Map<string, string>();
  for (const feature of features) {
    for (const section of feature.settingsSections ?? []) {
      validateSettingsSection(feature, section, routes, sections);
    }
  }
}

function validateSettingsSection(
  feature: ClientFeature,
  section: NonNullable<ClientFeature['settingsSections']>[number],
  routes: ReadonlyMap<string, string | undefined>,
  sections: Map<string, string>,
): void {
  const existingFeatureId = sections.get(section.id);
  if (existingFeatureId) {
    throw new SettingsCompositionError(
      section.id,
      `Settings section "${section.id}" is contributed by both features "${existingFeatureId}" and "${feature.id}".`,
      [existingFeatureId, feature.id],
    );
  }
  const path = settingsSectionPath(section);
  const normalizedPath = normalizeRoutePath(path);
  const routeOwner = routes.get(normalizedPath);
  if (routeOwner === undefined && !routes.has(normalizedPath)) {
    throw new SettingsCompositionError(
      section.id,
      `Settings section "${section.id}" in feature "${feature.id}" requires route "${path}".`,
      [feature.id],
    );
  }
  if (routeOwner && routeOwner !== feature.id && !hasExplicitCoordinator(feature)) {
    throw new SettingsCompositionError(
      section.id,
      `Settings section "${section.id}" in feature "${feature.id}" targets route "${path}" owned by feature "${routeOwner}". Declare coordinator: "${feature.id}" to own this cross-feature contribution.`,
      [routeOwner, feature.id],
    );
  }
  sections.set(section.id, feature.id);
}

function settingsSectionPath(
  section: NonNullable<ClientFeature['settingsSections']>[number],
): string {
  if (section.scope === 'project') {
    return `/w/$workspaceSlug/p/$projectSlug/settings/${section.pathSegment}`;
  }
  return `/w/$workspaceSlug/settings/${section.pathSegment}`;
}
