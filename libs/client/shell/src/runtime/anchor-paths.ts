import {normalizeRoutePath} from '#compose/normalize-route-path.js';
import type {RouteParentId} from '#contract.js';

const anchorPaths = {
  root: '/',
  workspaceLayout: '/workspaces/$wid',
  projectLayout: '/workspaces/$wid/projects/$pid',
  workspaceSettings: '/workspaces/$wid/settings',
} as const;

export {anchorPaths};

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
