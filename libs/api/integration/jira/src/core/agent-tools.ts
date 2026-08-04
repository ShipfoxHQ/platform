import type {
  JiraAgentToolId,
  JiraAgentToolRequiredScope,
  JiraAgentToolCatalogEntry as JiraDtoAgentToolCatalogEntry,
} from '@shipfox/api-integration-jira-dto';
import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';
import type {JiraAgentToolHttpMethod, JiraAgentToolQueryValue} from '#api/client.js';

export type JiraAgentToolCatalogEntry = JiraDtoAgentToolCatalogEntry;
export type {JiraAgentToolId, JiraAgentToolRequiredScope};

interface JiraAgentToolCatalogInput {
  id: JiraAgentToolId;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: JiraAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const issueIdOrKeySchema = stringSchema('Jira issue ID or key, such as ENG-123');
const projectIdOrKeySchema = stringSchema('Jira project ID or key, such as ENG');
const fieldsSchema = recordSchema('Jira issue fields keyed by their REST API field name');
const updateSchema = recordSchema('Jira issue field update operations');
const fieldNamesSchema = arraySchema(stringSchema('Jira field name'));
const propertiesSchema = arraySchema(stringSchema('Jira issue property key'));

export const jiraAgentToolCatalog = [
  tool({
    id: 'get_issue',
    description: 'Retrieve a Jira issue by its ID or key.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        fields: fieldNamesSchema,
        fieldsByKeys: booleanSchema('Interpret fields by their keys instead of IDs'),
        expand: stringSchema('Comma-separated Jira issue expansions'),
        properties: propertiesSchema,
        updateHistory: booleanSchema('Record this issue as viewed by the authorizing user'),
      },
      ['idOrKey'],
    ),
  }),
  tool({
    id: 'search_issues',
    description: 'Search Jira issues with a JQL query.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        jql: stringSchema('Jira Query Language expression'),
        maxResults: integerSchema('Maximum number of issues to return'),
        nextPageToken: stringSchema('Pagination token from a previous search'),
        fields: fieldNamesSchema,
        fieldsByKeys: booleanSchema('Interpret fields by their keys instead of IDs'),
        expand: stringSchema('Comma-separated Jira issue expansions'),
        properties: propertiesSchema,
        reconcileIssues: arraySchema(integerSchema('Issue ID to reconcile for read-after-write')),
      },
      ['jql'],
    ),
  }),
  tool({
    id: 'get_issue_comments',
    description: 'List the comments on a Jira issue.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        startAt: integerSchema('Zero-based comment offset'),
        maxResults: integerSchema('Maximum number of comments to return'),
        orderBy: stringSchema('Comment ordering expression'),
        expand: stringSchema('Comma-separated Jira comment expansions'),
      },
      ['idOrKey'],
    ),
  }),
  tool({
    id: 'get_issue_transitions',
    description: 'List the workflow transitions available for a Jira issue.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        expand: stringSchema('Comma-separated transition expansions, such as transitions.fields'),
      },
      ['idOrKey'],
    ),
  }),
  tool({
    id: 'get_project',
    description: 'Retrieve a Jira project by its ID or key.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        idOrKey: projectIdOrKeySchema,
        expand: stringSchema('Comma-separated Jira project expansions'),
        properties: propertiesSchema,
      },
      ['idOrKey'],
    ),
  }),
  tool({
    id: 'get_user',
    description: 'Retrieve a Jira user by Atlassian account ID.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        accountId: stringSchema('Atlassian account ID'),
        expand: stringSchema('Comma-separated Jira user expansions'),
      },
      ['accountId'],
    ),
  }),
  tool({
    id: 'create_issue',
    description:
      'Create a Jira issue using Jira REST issue fields. If both a project key and project ID or both an issue type name and issue type ID are supplied, the ID takes precedence.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        projectKey: stringSchema(
          'Jira project key; projectId takes precedence if both are supplied',
        ),
        projectId: stringSchema('Jira project ID; takes precedence over projectKey'),
        summary: stringSchema('Issue summary'),
        issueType: stringSchema(
          'Issue type name; issueTypeId takes precedence if both are supplied',
        ),
        issueTypeId: stringSchema('Issue type ID; takes precedence over issueType'),
        assigneeAccountId: stringSchema('Atlassian account ID to assign'),
        priority: stringSchema('Jira priority name'),
        labels: arraySchema(stringSchema('Jira label')),
        body: stringSchema('Plain-text issue description'),
        fields: fieldsSchema,
        update: updateSchema,
      },
      ['summary'],
    ),
  }),
  tool({
    id: 'update_issue',
    description: 'Update a Jira issue using Jira REST issue fields.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        summary: stringSchema('Replacement issue summary'),
        issueType: stringSchema(
          'Replacement issue type name; issueTypeId takes precedence if both are supplied',
        ),
        issueTypeId: stringSchema('Replacement issue type ID; takes precedence over issueType'),
        assigneeAccountId: stringSchema('Atlassian account ID to assign'),
        priority: stringSchema('Replacement Jira priority name'),
        labels: arraySchema(stringSchema('Replacement Jira labels')),
        body: stringSchema('Plain-text replacement issue description'),
        fields: fieldsSchema,
        update: updateSchema,
      },
      ['idOrKey'],
    ),
  }),
  tool({
    id: 'add_comment',
    description: 'Add a plain-text comment to a Jira issue.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        body: stringSchema('Plain-text comment body'),
      },
      ['idOrKey', 'body'],
    ),
  }),
  tool({
    id: 'transition_issue',
    description: 'Move a Jira issue through a workflow transition.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        transitionId: stringSchema('Jira workflow transition ID'),
        fields: fieldsSchema,
        update: updateSchema,
      },
      ['idOrKey', 'transitionId'],
    ),
  }),
  tool({
    id: 'assign_issue',
    description: 'Assign or unassign a Jira issue by Atlassian account ID.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        idOrKey: issueIdOrKeySchema,
        accountId: nullableStringSchema('Atlassian account ID, or null to unassign'),
      },
      ['idOrKey', 'accountId'],
    ),
  }),
] as const satisfies readonly JiraAgentToolCatalogEntry[];

export const jiraAgentToolSelectionCatalog =
  buildJiraAgentToolSelectionCatalog(jiraAgentToolCatalog);

export interface JiraToolOperation {
  method: JiraAgentToolHttpMethod;
  path: (args: Record<string, unknown>) => string;
  query?: ((args: Record<string, unknown>) => Record<string, JiraAgentToolQueryValue>) | undefined;
  body?: ((args: Record<string, unknown>) => unknown) | undefined;
}

export const JIRA_TOOL_OPERATIONS: Record<JiraAgentToolId, JiraToolOperation> = {
  get_issue: {
    method: 'GET',
    path: (args) => issuePath(args),
    query: (args) =>
      definedArguments(args, ['fields', 'fieldsByKeys', 'expand', 'properties', 'updateHistory']),
  },
  search_issues: {
    method: 'POST',
    path: () => '/search/jql',
    body: (args) =>
      definedArguments(args, [
        'jql',
        'maxResults',
        'nextPageToken',
        'fields',
        'fieldsByKeys',
        'expand',
        'properties',
        'reconcileIssues',
      ]),
  },
  get_issue_comments: {
    method: 'GET',
    path: (args) => issuePath(args, 'comment'),
    query: (args) => definedArguments(args, ['startAt', 'maxResults', 'orderBy', 'expand']),
  },
  get_issue_transitions: {
    method: 'GET',
    path: (args) => issuePath(args, 'transitions'),
    query: (args) => definedArguments(args, ['expand']),
  },
  get_project: {
    method: 'GET',
    path: (args) => `/project/${encodeURIComponent(stringArgument(args, 'idOrKey'))}`,
    query: (args) => definedArguments(args, ['expand', 'properties']),
  },
  get_user: {
    method: 'GET',
    path: () => '/user',
    query: (args) => definedArguments(args, ['accountId', 'expand']),
  },
  create_issue: {
    method: 'POST',
    path: () => '/issue',
    body: (args) => issueWriteBody(args),
  },
  update_issue: {
    method: 'PUT',
    path: (args) => issuePath(args),
    body: (args) => issueWriteBody(args),
  },
  add_comment: {
    method: 'POST',
    path: (args) => issuePath(args, 'comment'),
    body: (args) => ({body: jiraPlainTextToAdf(stringArgument(args, 'body'))}),
  },
  transition_issue: {
    method: 'POST',
    path: (args) => issuePath(args, 'transitions'),
    body: (args) => transitionBody(args),
  },
  assign_issue: {
    method: 'PUT',
    path: (args) => issuePath(args, 'assignee'),
    body: (args) => ({accountId: args.accountId}),
  },
};

export function jiraPlainTextToAdf(body: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{type: 'text', text: body}],
      },
    ],
  };
}

function buildJiraAgentToolSelectionCatalog(
  catalog: readonly AgentToolCatalogEntry<JiraAgentToolRequiredScope>[],
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

function issuePath(args: Record<string, unknown>, suffix = ''): string {
  return `/issue/${encodeURIComponent(stringArgument(args, 'idOrKey'))}${suffix ? `/${suffix}` : ''}`;
}

function issueWriteBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const fields = issueFields(args);
  if (Object.keys(fields).length > 0) body.fields = fields;
  if (isRecord(args.update)) body.update = args.update;
  return body;
}

function issueFields(args: Record<string, unknown>): Record<string, unknown> {
  const fields = isRecord(args.fields) ? {...args.fields} : {};
  const projectKey = stringArgumentOrUndefined(args, 'projectKey');
  const projectId = stringArgumentOrUndefined(args, 'projectId');
  const summary = stringArgumentOrUndefined(args, 'summary');
  const issueType = stringArgumentOrUndefined(args, 'issueType');
  const issueTypeId = stringArgumentOrUndefined(args, 'issueTypeId');
  const assigneeAccountId = args.assigneeAccountId;
  const priority = stringArgumentOrUndefined(args, 'priority');

  if (projectKey !== undefined) fields.project = {key: projectKey};
  if (projectId !== undefined) fields.project = {id: projectId};
  if (summary !== undefined) fields.summary = summary;
  if (issueType !== undefined) fields.issuetype = {name: issueType};
  if (issueTypeId !== undefined) fields.issuetype = {id: issueTypeId};
  if (typeof assigneeAccountId === 'string') fields.assignee = {accountId: assigneeAccountId};
  if (priority !== undefined) fields.priority = {name: priority};
  if (Array.isArray(args.labels)) fields.labels = args.labels;
  if (typeof args.body === 'string') fields.description = jiraPlainTextToAdf(args.body);

  return fields;
}

function transitionBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    transition: {id: stringArgument(args, 'transitionId')},
  };
  const fields = isRecord(args.fields) ? args.fields : undefined;
  if (fields !== undefined) body.fields = fields;
  if (isRecord(args.update)) body.update = args.update;
  return body;
}

function definedArguments(
  args: Record<string, unknown>,
  names: readonly string[],
): Record<string, JiraAgentToolQueryValue> {
  return Object.fromEntries(
    names.map((name) => [name, args[name]] as const).filter(([, value]) => value !== undefined),
  ) as Record<string, JiraAgentToolQueryValue>;
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function stringArgumentOrUndefined(
  args: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = args[name];
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tool(input: JiraAgentToolCatalogInput): JiraAgentToolCatalogEntry {
  return input;
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

function recordSchema(description?: string): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    ...(description === undefined ? {} : {description}),
  };
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description === undefined ? {} : {description})};
}

function nullableStringSchema(description?: string): AgentToolJsonSchema {
  return {type: ['string', 'null'], ...(description === undefined ? {} : {description})};
}

function integerSchema(description?: string): AgentToolJsonSchema {
  return {type: 'integer', ...(description === undefined ? {} : {description})};
}

function booleanSchema(description?: string): AgentToolJsonSchema {
  return {type: 'boolean', ...(description === undefined ? {} : {description})};
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}
