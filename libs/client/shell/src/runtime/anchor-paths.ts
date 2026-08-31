import {normalizeRoutePath} from '#compose/normalize-route-path.js';
import type {RouteParentId} from '#contract.js';

const anchorPaths = {
  root: '/',
  workspaceLayout: '/w/$workspaceSlug',
  projectLayout: '/w/$workspaceSlug/p/$projectSlug',
  workspaceSettings: '/w/$workspaceSlug/settings',
  projectSettings: '/w/$workspaceSlug/p/$projectSlug/settings',
} as const;

const entityPrefixRegistry = {
  w: 'workspace',
  p: 'project',
} as const;

const slugParamPrefixes = {
  workspaceSlug: 'w',
  projectSlug: 'p',
} as const;

export {anchorPaths, entityPrefixRegistry, slugParamPrefixes};

export function validateRoutePathInvariants(path: string): void {
  const segments = path.split('/').filter(Boolean);
  const seenSlugParams = new Set<string>();

  validateLegacyWorkspacePrefix(path, segments);

  for (const [index, segment] of segments.entries()) {
    validateRouteSegment(path, segments, index, segment, seenSlugParams);
  }

  validateEntityPrefixOrder(path, segments);
}

function validateLegacyWorkspacePrefix(path: string, segments: string[]): void {
  if (segments[0] !== 'workspaces' || !segments[1]?.startsWith('$')) return;
  throw new Error(
    `Route "${path}" must use the slug-based workspace prefix "w" instead of the legacy "/workspaces" path.`,
  );
}

function validateRouteSegment(
  path: string,
  segments: string[],
  index: number,
  segment: string,
  seenSlugParams: Set<string>,
): void {
  validateEntityPrefix(path, segment, segments[index + 1]);
  if (!segment.startsWith('$')) return;

  const param = segment.slice(1) as keyof typeof slugParamPrefixes;
  const prefix = Object.hasOwn(slugParamPrefixes, param) ? slugParamPrefixes[param] : undefined;
  if (prefix !== undefined) {
    validateSlugParameter(path, param, prefix, segments[index - 1], seenSlugParams);
    return;
  }
  validateUuidParameter(path, param, segments[index - 1]);
}

function validateEntityPrefix(
  path: string,
  segment: string,
  nextSegment: string | undefined,
): void {
  if (segment.length !== 1 || !Object.hasOwn(entityPrefixRegistry, segment)) return;
  if (nextSegment?.startsWith('$')) return;
  throw new Error(
    `Route "${path}" uses prefix "${segment}" without a dynamic parameter immediately after it.`,
  );
}

function validateSlugParameter(
  path: string,
  param: keyof typeof slugParamPrefixes,
  prefix: string,
  previousSegment: string | undefined,
  seenSlugParams: Set<string>,
): void {
  if (seenSlugParams.has(param)) {
    throw new Error(`Route "${path}" repeats slug parameter "${param}".`);
  }
  seenSlugParams.add(param);
  if (previousSegment !== prefix) {
    throw new Error(`Route "${path}" places slug parameter "${param}" outside prefix "${prefix}".`);
  }
}

function validateUuidParameter(
  path: string,
  param: string,
  previousSegment: string | undefined,
): void {
  if (
    previousSegment &&
    !previousSegment.startsWith('$') &&
    !Object.hasOwn(entityPrefixRegistry, previousSegment)
  ) {
    return;
  }
  throw new Error(`Route "${path}" must place UUID parameter "${param}" after a page segment.`);
}

function validateEntityPrefixOrder(path: string, segments: string[]): void {
  const workspacePrefixIndex = segments.indexOf('w');
  const projectPrefixIndex = segments.indexOf('p');
  if (
    workspacePrefixIndex !== -1 &&
    projectPrefixIndex !== -1 &&
    workspacePrefixIndex > projectPrefixIndex
  ) {
    throw new Error(`Route "${path}" must place workspace prefix "w" before project prefix "p".`);
  }
  if (workspacePrefixIndex !== -1 && workspacePrefixIndex !== 0) {
    throw new Error(`Route "${path}" must place workspace prefix "w" at the start of the path.`);
  }
  if (projectPrefixIndex !== -1 && (workspacePrefixIndex !== 0 || projectPrefixIndex !== 2)) {
    throw new Error(`Route "${path}" must place workspace prefix "w" before project prefix "p".`);
  }
}

export function routePathForAnchor(anchor: keyof typeof anchorPaths, fullPath: string): string {
  const anchorPath = anchorPaths[anchor];
  if (anchor === 'root') return fullPath;
  if (fullPath === anchorPath) return '/';
  if (!fullPath.startsWith(`${anchorPath}/`)) {
    throw new Error(`Route "${fullPath}" must be nested under anchor "${anchor}" (${anchorPath}).`);
  }
  return fullPath.slice(anchorPath.length);
}

export function routePathForParent(
  parent: RouteParentId,
  fullPath: string,
  layoutPaths: ReadonlyMap<string, string> = new Map(),
): string {
  const normalizedPath = normalizeRoutePath(fullPath);
  const parentPath = Object.hasOwn(anchorPaths, parent)
    ? anchorPaths[parent as keyof typeof anchorPaths]
    : layoutPaths.get(parent);
  if (!parentPath) {
    throw new Error(`Route "${normalizedPath}" targets missing layout parent "${parent}".`);
  }
  if (parentPath === '/') return normalizedPath;
  if (normalizedPath === parentPath) return '/';
  if (parentPath !== '/' && !normalizedPath.startsWith(`${parentPath}/`)) {
    const parentKind = Object.hasOwn(anchorPaths, parent) ? 'anchor' : 'layout';
    throw new Error(
      `Route "${normalizedPath}" must be nested under ${parentKind} "${parent}" (${parentPath}).`,
    );
  }
  return normalizedPath.slice(parentPath.length);
}
