import {normalizeRoutePath} from '#compose/normalize-route-path.js';
import type {RouteParentId} from '#contract.js';

const anchorPaths = {
  root: '/',
  workspaceLayout: '/w/$workspaceSlug',
  projectLayout: '/w/$workspaceSlug/p/$projectSlug',
  workspaceSettings: '/w/$workspaceSlug/settings',
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

  if (segments[0] === 'workspaces' && segments[1]?.startsWith('$')) {
    throw new Error(
      `Route "${path}" must use the slug-based workspace prefix "w" instead of the legacy "/workspaces" path.`,
    );
  }

  for (const [index, segment] of segments.entries()) {
    const nextSegment = segments[index + 1];
    if (segment.length === 1 && Object.hasOwn(entityPrefixRegistry, segment)) {
      if (!nextSegment?.startsWith('$')) {
        throw new Error(
          `Route "${path}" uses prefix "${segment}" without a dynamic parameter immediately after it.`,
        );
      }
    }

    if (!segment.startsWith('$')) continue;
    const param = segment.slice(1) as keyof typeof slugParamPrefixes;
    const prefix = Object.hasOwn(slugParamPrefixes, param) ? slugParamPrefixes[param] : undefined;
    if (prefix !== undefined) {
      if (seenSlugParams.has(param)) {
        throw new Error(`Route "${path}" repeats slug parameter "${param}".`);
      }
      seenSlugParams.add(param);
      if (segments[index - 1] !== prefix) {
        throw new Error(
          `Route "${path}" places slug parameter "${param}" outside prefix "${prefix}".`,
        );
      }
    }
    if (prefix === undefined) {
      const previousSegment = segments[index - 1];
      if (
        !previousSegment ||
        previousSegment.startsWith('$') ||
        Object.hasOwn(entityPrefixRegistry, previousSegment)
      ) {
        throw new Error(
          `Route "${path}" must place UUID parameter "${param}" after a page segment.`,
        );
      }
    }
  }

  const workspacePrefixIndex = segments.indexOf('w');
  const projectPrefixIndex = segments.indexOf('p');
  if (projectPrefixIndex !== -1 && (workspacePrefixIndex !== 0 || projectPrefixIndex !== 2)) {
    throw new Error(`Route "${path}" must place workspace prefix "w" before project prefix "p".`);
  }
  if (workspacePrefixIndex !== -1 && workspacePrefixIndex !== 0) {
    throw new Error(`Route "${path}" must place workspace prefix "w" at the start of the path.`);
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
