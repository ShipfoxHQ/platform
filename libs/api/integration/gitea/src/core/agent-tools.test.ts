import {
  GITEA_TOOL_OPERATIONS,
  type GiteaToolOperation,
  giteaAgentToolCatalog,
  giteaAgentToolSelectionCatalog,
} from './agent-tools.js';

const expectedTools = [
  {id: 'get_issue', sensitivity: 'read', requiredScope: 'read'},
  {id: 'comment_on_issue', sensitivity: 'write', requiredScope: 'write'},
] as const;

function operation(id: string): GiteaToolOperation {
  const resolved = GITEA_TOOL_OPERATIONS[id as keyof typeof GITEA_TOOL_OPERATIONS];
  if (!resolved) throw new Error(`Unknown test operation: ${id}`);
  return resolved;
}

describe('giteaAgentToolCatalog', () => {
  it('defines the Gitea tools with their access requirements', () => {
    const tools = giteaAgentToolCatalog.map(({id, sensitivity, requiredScope, sensitive}) => ({
      id,
      sensitivity,
      requiredScope,
      sensitive,
    }));

    expect(tools).toEqual(expectedTools.map((tool) => ({...tool, sensitive: false})));
  });

  it('documents every tool with an object input schema', () => {
    const schemas = giteaAgentToolCatalog.map(({description, inputSchema}) => ({
      description,
      type: inputSchema.type,
    }));

    expect(schemas).toHaveLength(expectedTools.length);
    expect(
      schemas.every(({description, type}) => description.length > 0 && type === 'object'),
    ).toBe(true);
  });

  it('declares the gitea issue endpoints as tool inputs', () => {
    const getIssue = giteaAgentToolCatalog.find(({id}) => id === 'get_issue');
    const commentOnIssue = giteaAgentToolCatalog.find(({id}) => id === 'comment_on_issue');

    expect(getIssue?.inputSchema).toMatchObject({
      required: ['repo', 'index'],
      properties: {repo: {type: 'string'}, index: {type: 'integer'}},
    });
    expect(commentOnIssue?.inputSchema).toMatchObject({
      required: ['repo', 'index', 'body'],
      properties: {body: {type: 'string', maxLength: 12_000}},
    });
  });

  it('leaves the repository owner out of the tool inputs', () => {
    const inputs = giteaAgentToolCatalog.flatMap(({id, inputSchema}) => [
      ...Object.keys((inputSchema.properties as Record<string, unknown>) ?? {}).map(
        (name) => `${id}.${name}`,
      ),
    ]);

    expect(inputs).not.toContain('get_issue.owner');
    expect(inputs).not.toContain('comment_on_issue.owner');
  });

  it('maps every tool id to its Gitea client method', () => {
    const methods = Object.fromEntries(
      giteaAgentToolCatalog.map(({id}) => [id, operation(id).method]),
    );

    expect(methods).toEqual({
      get_issue: 'getIssue',
      comment_on_issue: 'createIssueComment',
    });
  });

  it('injects the connected organization as the repository owner', () => {
    expect(operation('get_issue').mapArguments({repo: 'platform', index: 3}, 'shipfox')).toEqual({
      owner: 'shipfox',
      repo: 'platform',
      index: 3,
    });
    expect(
      operation('comment_on_issue').mapArguments(
        {repo: 'platform', index: 3, body: 'Hello'},
        'shipfox',
      ),
    ).toEqual({owner: 'shipfox', repo: 'platform', index: 3, body: 'Hello'});
  });

  it('exposes one standalone selector per tool with matching sensitivity', () => {
    const selectors = giteaAgentToolSelectionCatalog.selectors;

    expect(selectors).toEqual(
      expectedTools.map(({id, sensitivity}) => ({
        token: id,
        kind: 'standalone',
        sensitivity,
        sensitive: false,
      })),
    );
  });
});
