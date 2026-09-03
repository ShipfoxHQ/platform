import {
  type GithubAppEndpointPermission,
  githubAppEndpointPermissions,
  normalizeGithubRoute,
} from '#test/index.js';
import {githubOperationRoute} from './agent-tools.js';
import {
  type GithubAgentToolId,
  type GithubAgentToolRequiredScope,
  githubAgentToolCatalog,
} from './github-agent-tool-catalog.js';

const GRAPHQL_ROUTE = 'POST /graphql';

/** Argument shapes that reach every branch of `githubOperationRoute` for a tool. */
const routeArgumentVariants: Record<string, Record<string, unknown>[]> = {
  add_issue_comment: [{body: 'x'}, {reaction: '+1'}, {comment_id: 1, reaction: '+1'}],
  add_reply_to_pull_request_comment: [{body: 'x'}, {reaction: '+1'}],
};

/** Routes the adapter builds with a literal segment where GitHub documents a placeholder. */
const documentedRouteAliases: Record<string, string> = {
  'GET /repos/{owner}/{repo}/actions/artifacts/{resource_id}/zip':
    'GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}',
};

/** Extra REST requests an operation issues around its main route. */
const supportingRoutes: Record<string, string[]> = {
  create_branch: ['GET /repos/{owner}/{repo}/git/ref/{ref}'],
  create_pull_request: ['POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers'],
  update_pull_request: ['POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers'],
  'pull_request_review_write.submit_pending': [
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
  ],
  'pull_request_review_write.delete_pending': [
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
  ],
  add_comment_to_pending_review: ['GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews'],
};

/** GraphQL operations have no REST snapshot entry, so their documented permission is pinned. */
const graphqlRequirements: Record<string, GithubAppEndpointPermission> = {
  'pull_request_read.get_review_threads': {permission: 'pull_requests', access: 'read'},
  'pull_request_review_thread_write.resolve': {permission: 'pull_requests', access: 'write'},
  add_comment_to_pending_review: {permission: 'pull_requests', access: 'write'},
  create_commit: {permission: 'contents', access: 'write'},
};

/** Search is gated only by the metadata grant every installation token carries. */
const metadataOnlyRoutes = new Set(['GET /search/issues']);

interface CatalogOperation {
  key: string;
  toolId: GithubAgentToolId;
  method: string | undefined;
  requiredScope: GithubAgentToolRequiredScope;
}

type EndpointPermissionSnapshot = ReadonlyMap<string, readonly GithubAppEndpointPermission[]>;

function catalogOperations(): CatalogOperation[] {
  return githubAgentToolCatalog.flatMap((entry): CatalogOperation[] => {
    const toolId = entry.id as GithubAgentToolId;
    if (entry.methods === undefined) {
      return [{key: entry.id, toolId, method: undefined, requiredScope: entry.requiredScope}];
    }
    return entry.methods.map((method) => ({
      key: `${entry.id}.${method.id}`,
      toolId,
      method: method.id,
      requiredScope: method.requiredScope,
    }));
  });
}

function operationRoutes(operation: CatalogOperation): Set<string> {
  const routes = new Set<string>();
  for (const args of routeArgumentVariants[operation.toolId] ?? [{}]) {
    const route = githubOperationRoute(operation.toolId, operation.method, args);
    expect(route, `${operation.key} has no route case`).toBeDefined();
    if (route !== undefined) routes.add(documentedRouteAliases[route] ?? route);
  }
  for (const route of supportingRoutes[operation.key] ?? supportingRoutes[operation.toolId] ?? []) {
    routes.add(route);
  }
  return routes;
}

function requiredPermissions(
  operation: CatalogOperation,
  route: string,
  snapshot: EndpointPermissionSnapshot,
): readonly GithubAppEndpointPermission[] | undefined {
  if (route === GRAPHQL_ROUTE) {
    const requirement = graphqlRequirements[operation.key];
    expect(requirement, `${operation.key} needs a pinned GraphQL permission`).toBeDefined();
    return requirement === undefined ? undefined : [requirement];
  }
  if (metadataOnlyRoutes.has(route)) return undefined;
  const required = snapshot.get(normalizeGithubRoute(route));
  expect(required, `${route} is not a documented GitHub App endpoint`).toBeDefined();
  return required;
}

function declaredScopeSatisfies(
  declared: GithubAgentToolRequiredScope,
  required: readonly GithubAppEndpointPermission[],
): boolean {
  // Metadata read is implicit on every installation token and never declared in the catalog.
  if (required.some((entry) => entry.permission === 'metadata')) return true;
  return required.some((entry) =>
    declared.some(
      (scope) =>
        scope.permission === entry.permission &&
        (scope.access === entry.access || (scope.access === 'write' && entry.access === 'read')),
    ),
  );
}

function formatScope(scope: readonly GithubAppEndpointPermission[]): string {
  return scope.map(({permission, access}) => `${permission}:${access}`).join(', ');
}

describe('github agent tool permissions', () => {
  const snapshot = githubAppEndpointPermissions();

  it.each(catalogOperations())('declares a permission GitHub requires for $key', (operation) => {
    for (const route of operationRoutes(operation)) {
      const required = requiredPermissions(operation, route, snapshot);
      if (required === undefined) continue;
      expect(
        declaredScopeSatisfies(operation.requiredScope, required),
        `${operation.key} declares ${formatScope(operation.requiredScope)} but ${route} needs one of ${formatScope(required)}`,
      ).toBe(true);
    }
  });
});
