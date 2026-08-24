import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type GiteaAgentToolRequiredScope = 'read' | 'write';
export type GiteaAgentToolCatalogEntry = AgentToolCatalogEntry<GiteaAgentToolRequiredScope>;

interface GiteaAgentToolCatalogInput {
  id: string;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: GiteaAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const repoSchema = stringSchema(
  'Repository name within the connected Gitea organization, such as platform',
);
const issueIndexSchema = integerSchema('Issue number, such as 12');
const commentBodySchema = stringSchema('Comment body, written as Markdown');

// Gitea connections are organization-scoped, so every tool call targets a
// repository in the connected organization and the server injects the owner
// from the connection; `owner` is not a tool input.
export const giteaAgentToolCatalog = [
  tool({
    id: 'get_issue',
    description:
      'Read a Gitea issue from a repository in the connected organization: number, title, body, state, comment count, and timestamps.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        repo: repoSchema,
        index: issueIndexSchema,
      },
      ['repo', 'index'],
    ),
  }),
  tool({
    id: 'comment_on_issue',
    description:
      'Add a comment to a Gitea issue in a repository of the connected organization. Returns the created comment.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        repo: repoSchema,
        index: issueIndexSchema,
        body: commentBodySchema,
      },
      ['repo', 'index', 'body'],
    ),
  }),
] as const satisfies readonly GiteaAgentToolCatalogEntry[];

export type GiteaAgentToolId = (typeof giteaAgentToolCatalog)[number]['id'];

export interface GiteaGetIssueToolOperation {
  readonly method: 'getIssue';
  readonly mapArguments: (
    args: Record<string, unknown>,
    owner: string,
  ) => {owner: string; repo: string; index: number};
}

export interface GiteaCreateIssueCommentToolOperation {
  readonly method: 'createIssueComment';
  readonly mapArguments: (
    args: Record<string, unknown>,
    owner: string,
  ) => {owner: string; repo: string; index: number; body: string};
}

export type GiteaToolOperation = GiteaGetIssueToolOperation | GiteaCreateIssueCommentToolOperation;

// Tool inputs already follow the Gitea REST API's own parameter names, so each
// operation only injects the owner of the connected organization before the
// client call is dispatched.
export const GITEA_TOOL_OPERATIONS = {
  get_issue: {
    method: 'getIssue',
    mapArguments: (args, owner) => ({
      owner,
      repo: stringArgument(args, 'repo'),
      index: integerArgument(args, 'index'),
    }),
  },
  comment_on_issue: {
    method: 'createIssueComment',
    mapArguments: (args, owner) => ({
      owner,
      repo: stringArgument(args, 'repo'),
      index: integerArgument(args, 'index'),
      body: stringArgument(args, 'body'),
    }),
  },
} as const satisfies Record<GiteaAgentToolId, GiteaToolOperation>;

export const giteaAgentToolSelectionCatalog =
  buildGiteaAgentToolSelectionCatalog(giteaAgentToolCatalog);

function buildGiteaAgentToolSelectionCatalog(
  catalog: readonly GiteaAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.map(
      (entry): AgentToolSelector => ({
        token: entry.id,
        kind: 'standalone',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
      }),
    ),
  };
}

function tool<const Entry extends GiteaAgentToolCatalogInput>(input: Entry): Entry {
  return input;
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function integerArgument(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function integerSchema(description: string): AgentToolJsonSchema {
  return {type: 'integer', description};
}
