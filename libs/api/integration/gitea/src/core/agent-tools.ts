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
const commentBodySchema = {
  ...stringSchema('Comment body, written as Markdown'),
  maxLength: 12_000,
};

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

export function validateGiteaToolArguments(
  tool: GiteaAgentToolCatalogEntry,
  args: Record<string, unknown>,
): string | undefined {
  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  for (const name of required) {
    if (typeof name === 'string' && args[name] === undefined) {
      return `Missing required parameter: ${name}`;
    }
  }

  const properties = tool.inputSchema.properties;
  if (!isRecord(properties)) return undefined;

  for (const [name, value] of Object.entries(args)) {
    const schema = properties[name];
    if (!isRecord(schema)) return `Unknown parameter: ${name}`;
    const invalid = validateGiteaArgument(name, value, schema);
    if (invalid !== undefined) return invalid;
  }

  return undefined;
}

function validateGiteaArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (schema.type === 'string') return validateGiteaStringArgument(name, value, schema);
  if (schema.type === 'integer') return validateGiteaIntegerArgument(name, value);
  return undefined;
}

function validateGiteaStringArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (typeof value !== 'string') return `Parameter ${name} must be a string`;
  if (value.trim().length === 0) return `Parameter ${name} must not be empty`;
  if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) {
    return `Parameter ${name} must be at most ${schema.maxLength} characters`;
  }
  if (name === 'repo' && !isSafeRepositoryName(value)) {
    return `Parameter ${name} must be a repository name`;
  }
  return undefined;
}

function validateGiteaIntegerArgument(name: string, value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return `Parameter ${name} must be an integer`;
  }
  if (value < 1) return `Parameter ${name} must be a positive integer`;
  return undefined;
}

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
  if (typeof value !== 'string') throw new TypeError(`Parameter ${name} must be a string`);
  return value;
}

function integerArgument(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`Parameter ${name} must be a positive integer`);
  }
  return value;
}

function isSafeRepositoryName(value: string): boolean {
  return value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');
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
  return {type: 'integer', minimum: 1, description};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
