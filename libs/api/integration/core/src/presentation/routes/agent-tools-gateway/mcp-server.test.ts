import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {giteaAgentToolCatalog} from '@shipfox/api-integration-gitea';
import {githubAgentToolCatalog} from '@shipfox/api-integration-github';
import {jiraAgentToolCatalog} from '@shipfox/api-integration-jira';
import {linearAgentToolCatalog} from '@shipfox/api-integration-linear';
import {slackAgentToolCatalog} from '@shipfox/api-integration-slack';
import type {AgentToolCatalogEntry, AgentToolJsonSchema} from '@shipfox/api-integration-spi';
import {INVALID_METHOD_LABEL, NO_METHOD_LABEL} from '#core/tool-call-audit.js';
import {
  catalogTool,
  catalogWithRepositoryScope,
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {createIntegrationToolDispatcher} from './dispatch.js';
import {buildAgentToolsMcpServer, type IntegrationToolDispatchInput} from './mcp-server.js';
import type {
  AuthorizedIntegrationTool,
  AuthorizedIntegrationToolMap,
} from './resolve-authorized-tools.js';

describe('buildAgentToolsMcpServer', () => {
  it('lists namespaced tools and dispatches authorized method-family calls', async () => {
    const dispatch = vi.fn(async (input: IntegrationToolDispatchInput) => ({
      content: [{type: 'text' as const, text: `called:${input.method}`}],
    }));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    const tools = await client.listTools();
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(tools.tools).toMatchObject([
      {
        name: 'github_main__issue_read',
        description: 'Read issue metadata from GitHub.',
      },
    ]);
    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'get',
        arguments: expect.objectContaining({issue_number: 1}),
      }),
    );
    expect(records).toMatchObject([
      {
        authorizedTool: expect.objectContaining({
          integration: expect.objectContaining({provider: 'github'}),
          tool: expect.objectContaining({id: 'issue_read'}),
        }),
        method: 'get',
        outcome: 'success',
        errorCode: 'none',
      },
    ]);
  });

  it('records the shared repository denial returned by the MCP dispatcher', async () => {
    const entry = catalogWithRepositoryScope(() => ({
      kind: 'declared-targets',
      repositories: [{owner: 'shipfox', name: 'platform'}],
    }));
    const onOpenSession = vi.fn();
    const resolveRepositoryAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'repository_not_granted' as const,
    }));
    const authorizedTools = defaultAuthorizedTools();
    const authorizedTool = authorizedTools.get('github_main__issue_read');
    if (!authorizedTool) throw new Error('Expected default authorized tool');
    authorizedTools.set('github_main__issue_read', {...authorizedTool, catalogEntry: entry});
    const dispatch = createIntegrationToolDispatcher({
      registry: registryWithAgentTools([entry], {
        repositoryAuthorization: 'enforced',
        onOpenSession,
      }),
      lease: leaseContext({
        workspaceId: 'workspace-1',
        projectId: 'project-run',
      }),
      repositoryAuthorizer: {
        enabled: true,
        resolveRepositoryAuthorization,
      },
    });
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, authorizedTools, (record) =>
      records.push(record),
    );

    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(resolveRepositoryAuthorization).toHaveBeenCalledTimes(1);
    expect(records).toMatchObject([
      {
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'repository-not-granted',
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'declared-targets',
        repositoryAccess: 'selected',
        decision: 'denied',
        denialReason: 'repository_not_granted',
        runProjectId: 'project-run',
      },
    ]);
  });

  it.each([
    ['unknown tool', 'missing__tool', {method: 'get'}, NO_METHOD_LABEL, undefined],
    ['missing method', 'github_main__issue_read', {}, INVALID_METHOD_LABEL, 'issue_read'],
    [
      'non-string method',
      'github_main__issue_read',
      {method: 1},
      INVALID_METHOD_LABEL,
      'issue_read',
    ],
    [
      'unauthorized method',
      'github_main__issue_read',
      {method: 'get_labels'},
      INVALID_METHOD_LABEL,
      'issue_read',
    ],
  ])('returns an isError tool result and records invalid-request for %s', async (_label, name, args, expectedMethod, expectedToolId) => {
    const dispatch = vi.fn();
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    const result = await client.callTool({name, arguments: args}, CallToolResultSchema);
    await close();

    expect(result.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(records).toMatchObject([
      {
        method: expectedMethod,
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
      },
    ]);
    if (expectedToolId) {
      expect(records[0]?.authorizedTool).toEqual(
        expect.objectContaining({tool: expect.objectContaining({id: expectedToolId})}),
      );
    } else {
      expect(records[0]?.authorizedTool).toBeUndefined();
    }
  });

  it('returns stable protocol details for a missing method', async () => {
    const dispatch = vi.fn();
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools());

    const result = await client.callTool(
      {name: 'github_main__issue_read', arguments: {}},
      CallToolResultSchema,
    );
    await close();

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'invalid-request',
        reason: 'missing_required_parameter',
        tool: 'issue_read',
        parameter: 'method',
      },
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('returns a stable tool-not-found reason without exposing it as a provider error', async () => {
    const dispatch = vi.fn();
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools());

    const result = await client.callTool(
      {name: 'github_main__missing_tool', arguments: {}},
      CallToolResultSchema,
    );
    await close();

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'invalid-request',
        reason: 'tool_not_found',
        tool: 'github_main__missing_tool',
      },
    });
  });

  it('ignores a stray method argument for standalone tools', async () => {
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'called'}],
    }));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, standaloneTools(), (record) =>
      records.push(record),
    );

    const result = await client.callTool(
      {name: 'github_main__list_issues', arguments: {method: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: undefined,
        arguments: {method: 'ignored'},
      }),
    );
    expect(records).toMatchObject([
      {method: NO_METHOD_LABEL, outcome: 'success', errorCode: 'none'},
    ]);
  });

  it('defaults omitted arguments to an empty object for optional-argument tools', async () => {
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'called'}],
    }));
    const {client, close} = await connectClient(dispatch, standaloneTools());

    const result = await client.callTool({name: 'github_main__list_issues'}, CallToolResultSchema);
    await close();

    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: {},
      }),
    );
  });

  it('leaves provider argument validation to the selected provider', async () => {
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'called'}],
    }));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {
          method: 'get',
          owner: 'shipfox',
          repo: 'platform',
          issue_number: 'not-an-integer',
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).not.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        arguments: expect.objectContaining({issue_number: 'not-an-integer'}),
      }),
    );
    expect(records).toMatchObject([{method: 'get', outcome: 'success', errorCode: 'none'}]);
  });

  it('records tool-error when dispatch returns an error result', async () => {
    const dispatch = vi.fn(async () => ({
      isError: true,
      content: [{type: 'text' as const, text: 'provider rejected call'}],
    }));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(records).toMatchObject([{method: 'get', outcome: 'tool-error', errorCode: 'unknown'}]);
  });

  it('records exception before rethrowing dispatcher failures', async () => {
    const dispatch = vi.fn(() => Promise.reject(new Error('provider unavailable')));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    await expect(
      client.callTool(
        {
          name: 'github_main__issue_read',
          arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
        },
        CallToolResultSchema,
      ),
    ).rejects.toThrow('MCP error -32603');
    await close();

    expect(records).toMatchObject([{method: 'get', outcome: 'exception', errorCode: 'unknown'}]);
  });

  it('records bounded provider error details returned by the dispatcher', async () => {
    const dispatch = vi.fn(async () => ({
      isError: true,
      content: [{type: 'text' as const, text: 'provider rejected call'}],
      structuredContent: {code: 'provider-rejected', status: 422},
    }));
    const records: Parameters<
      NonNullable<Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall']>
    >[0][] = [];
    const {client, close} = await connectClient(dispatch, defaultAuthorizedTools(), (record) =>
      records.push(record),
    );

    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(records).toMatchObject([
      {
        method: 'get',
        outcome: 'tool-error',
        errorCode: 'provider-rejected',
        providerStatus: 422,
      },
    ]);
  });

  it('passes structured errors through the SDK for tools with output schemas', async () => {
    const authorizedTools = defaultAuthorizedTools();
    const authorizedTool = authorizedTools.get('github_main__issue_read');
    if (!authorizedTool) throw new Error('Expected default authorized tool');
    authorizedTools.set('github_main__issue_read', {
      ...authorizedTool,
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {issue: {type: 'string'}},
        required: ['issue'],
      },
    });
    const dispatch = vi.fn(async () => ({
      isError: true,
      content: [{type: 'text' as const, text: 'commit_id is missing'}],
      structuredContent: {code: 'provider-rejected', status: 422},
    }));
    const {client, close} = await connectClient(dispatch, authorizedTools);

    const tools = await client.listTools();
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(tools.tools[0]?.outputSchema).toMatchObject({
      type: 'object',
      anyOf: expect.any(Array),
    });
    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'commit_id is missing'}],
      structuredContent: {code: 'provider-rejected', status: 422},
    });
  });

  it('keeps output schema references rooted when adding an error branch', async () => {
    const authorizedTools = defaultAuthorizedTools();
    const authorizedTool = authorizedTools.get('github_main__issue_read');
    if (!authorizedTool) throw new Error('Expected default authorized tool');
    const outputSchema = {
      $id: 'urn:shipfox:integration-tool-output',
      $defs: {
        issue: {
          type: 'object',
          additionalProperties: false,
          properties: {id: {type: 'string'}},
          required: ['id'],
        },
      },
      type: 'object',
      additionalProperties: false,
      properties: {issue: {$ref: '#/$defs/issue'}},
      required: ['issue'],
    };
    authorizedTools.set('github_main__issue_read', {
      ...authorizedTool,
      outputSchema,
    });
    const dispatch = vi.fn(async () => ({
      content: [{type: 'text' as const, text: 'issue returned'}],
      structuredContent: {issue: {id: 'issue-1'}},
    }));
    const {client, close} = await connectClient(dispatch, authorizedTools);

    const tools = await client.listTools();
    const result = await client.callTool(
      {
        name: 'github_main__issue_read',
        arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      },
      CallToolResultSchema,
    );
    await close();

    expect(tools.tools[0]?.outputSchema).toEqual(
      expect.objectContaining({
        $id: outputSchema.$id,
        $defs: outputSchema.$defs,
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            properties: outputSchema.properties,
            required: outputSchema.required,
          }),
        ]),
      }),
    );
    expect(result).toMatchObject({structuredContent: {issue: {id: 'issue-1'}}});
  });

  it('validates error projections emitted by the integration dispatcher', async () => {
    const entry = catalogTool();
    const mcpName = 'github_main__issue_read';
    const authorizedTool = authorizedToolForCatalog(mcpName, 'github', entry, 0);
    const errorCases = [
      {
        providerResult: toolResult({code: 'provider-rejected'}, true),
        expected: {code: 'provider-rejected'},
      },
      {
        providerResult: toolResult({code: 'provider-rejected', status: 422}, true),
        expected: {code: 'provider-rejected', status: 422},
      },
      {
        providerResult: toolResult(
          {code: 'provider-timeout', status: 503, retryAfterSeconds: 3},
          true,
        ),
        expected: {code: 'provider-timeout', status: 503, retryAfterSeconds: 3},
      },
    ];

    for (const {providerResult, expected} of errorCases) {
      const dispatch = createIntegrationToolDispatcher({
        registry: registryWithAgentTools([entry], {result: providerResult}),
        lease: leaseContext({workspaceId: 'workspace-1'}),
      });
      const {client, close} = await connectClient(dispatch, new Map([[mcpName, authorizedTool]]));

      await client.listTools();
      const result = await client.callTool(
        {
          name: mcpName,
          arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
        },
        CallToolResultSchema,
      );
      await close();

      expect(result).toMatchObject({isError: true, structuredContent: expected});
    }
  });

  it('accepts success and structured error projections for every declared provider output schema', async () => {
    const catalogTools = declaredOutputSchemaTools();
    expect(catalogTools.length).toBeGreaterThan(0);
    const authorizedTools = new Map(
      catalogTools.map(
        ({mcpName, provider, entry}, index) =>
          [mcpName, authorizedToolForCatalog(mcpName, provider, entry, index)] as const,
      ),
    );
    const results = new Map<string, ReturnType<typeof toolResult>>();
    const dispatch = vi.fn((input: IntegrationToolDispatchInput) => {
      const result = results.get(input.authorizedTool.mcpName);
      if (!result) throw new Error(`Missing fixture for ${input.authorizedTool.mcpName}`);
      return Promise.resolve(result);
    });
    const {client, close} = await connectClient(dispatch, authorizedTools);

    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(catalogTools.length);

    for (const {mcpName, entry} of catalogTools) {
      const arguments_ = toolArguments(entry);
      const success = structuredContentFixture(entry.outputSchema);
      results.set(mcpName, toolResult(success));

      const listedTool = tools.tools.find((tool) => tool.name === mcpName);
      expect(listedTool?.outputSchema).toEqual(
        expect.objectContaining({
          type: 'object',
          anyOf: expect.arrayContaining([entry.outputSchema]),
        }),
      );

      const successResult = await client.callTool(
        {name: mcpName, arguments: arguments_},
        CallToolResultSchema,
      );
      expect(successResult).toMatchObject({structuredContent: success});

      for (const error of [
        {code: 'provider-rejected'},
        {code: 'provider-rejected', status: 422},
        {code: 'provider-timeout', status: 503, retryAfterSeconds: 3},
      ]) {
        results.set(mcpName, toolResult(error, true));

        const errorResult = await client.callTool(
          {name: mcpName, arguments: arguments_},
          CallToolResultSchema,
        );
        expect(errorResult).toMatchObject({isError: true, structuredContent: error});
      }
    }

    await close();
  });
});

async function connectClient(
  dispatch: Parameters<typeof buildAgentToolsMcpServer>[0]['dispatch'],
  authorizedTools = defaultAuthorizedTools(),
  recordCall?: Parameters<typeof buildAgentToolsMcpServer>[0]['recordCall'],
) {
  const server = buildAgentToolsMcpServer({authorizedTools, dispatch, recordCall});
  const client = new Client({name: 'test-client', version: '0.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function defaultAuthorizedTools(): AuthorizedIntegrationToolMap {
  const integration = materializedIntegration({connectionId: 'connection-1'});
  const tool = materializedTool();
  return new Map([
    [
      'github_main__issue_read',
      {
        mcpName: 'github_main__issue_read',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: catalogTool().description,
        inputSchema: tool.inputSchema,
      },
    ],
  ]);
}

function standaloneTools(): AuthorizedIntegrationToolMap {
  const integration = materializedIntegration({
    connectionId: 'connection-1',
    tools: [
      materializedTool({
        id: 'list_issues',
        methods: undefined,
        inputSchema: {type: 'object', properties: {}, additionalProperties: true},
      }),
    ],
  });
  const [tool] = integration.tools;
  if (!tool) throw new Error('Expected standalone integration tool');

  return new Map([
    [
      'github_main__list_issues',
      {
        mcpName: 'github_main__list_issues',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: 'List issues',
        inputSchema: tool.inputSchema,
      },
    ],
  ]);
}

type DeclaredOutputSchemaTool = {
  provider: string;
  entry: AgentToolCatalogEntry & {outputSchema: AgentToolJsonSchema};
  mcpName: string;
};

function declaredOutputSchemaTools(): DeclaredOutputSchemaTool[] {
  const providerCatalogs: Array<[string, readonly AgentToolCatalogEntry[]]> = [
    ['gitea', giteaAgentToolCatalog],
    ['github', githubAgentToolCatalog],
    ['jira', jiraAgentToolCatalog],
    ['linear', linearAgentToolCatalog],
    ['slack', slackAgentToolCatalog],
  ];
  return providerCatalogs.flatMap(([provider, catalog]) =>
    catalog.filter(hasOutputSchema).map((entry) => ({
      provider,
      entry,
      mcpName: `${provider}__${entry.id}`,
    })),
  );
}

function hasOutputSchema(
  entry: AgentToolCatalogEntry,
): entry is AgentToolCatalogEntry & {outputSchema: AgentToolJsonSchema} {
  return entry.outputSchema !== undefined;
}

function authorizedToolForCatalog(
  mcpName: string,
  provider: string,
  entry: AgentToolCatalogEntry,
  index: number,
): AuthorizedIntegrationTool {
  const tool = materializedTool({
    id: entry.id,
    sensitivity: entry.sensitivity,
    sensitive: entry.sensitive,
    requiredScope: Array.isArray(entry.requiredScope) ? entry.requiredScope : [entry.requiredScope],
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    methods: entry.methods?.map((method) => ({
      id: method.id,
      token: `${entry.id}.${method.id}`,
      description: method.description,
      sensitivity: method.sensitivity,
      sensitive: method.sensitive,
      requiredScope: Array.isArray(method.requiredScope)
        ? method.requiredScope
        : [method.requiredScope],
    })),
  });
  const connectionId = `connection-${provider}-${index}`;
  const connectionSlug = `${provider}-${index}`;
  const integration = materializedIntegration({
    connectionId,
    connectionSlug,
    provider,
    tools: [tool],
  });

  return {
    mcpName,
    integration,
    tool,
    connection: connection({id: connectionId, provider, slug: connectionSlug}),
    description: entry.description,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    catalogEntry: entry,
  };
}

function toolArguments(entry: AgentToolCatalogEntry): Record<string, unknown> {
  const method = entry.methods?.[0]?.id;
  return method === undefined ? {} : {method};
}

function structuredContentFixture(schema: Record<string, unknown>): Record<string, unknown> {
  const fixture = valueFixture(schema);
  if (!isRecord(fixture)) throw new Error('Expected an object output schema fixture');
  return fixture;
}

function valueFixture(schema: Record<string, unknown>): unknown {
  const literal = schemaLiteral(schema);
  if (literal !== undefined) return literal.value;

  const branch = schemaBranch(schema);
  if (branch) return valueFixture(branch);

  switch (schema.type) {
    case 'object':
      return objectFixture(schema);
    case 'array':
      return [];
    case 'boolean':
      return true;
    case 'integer':
    case 'number':
      return 1;
    case 'string':
      return 'fixture';
    case 'null':
      return null;
    default:
      return {};
  }
}

function schemaLiteral(schema: Record<string, unknown>): {value: unknown} | undefined {
  if (Object.hasOwn(schema, 'const')) return {value: schema.const};

  const enumValues = schema.enum;
  return Array.isArray(enumValues) && enumValues.length > 0 ? {value: enumValues[0]} : undefined;
}

function schemaBranch(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword];
    const firstBranch = Array.isArray(branches) ? branches.find(isRecord) : undefined;
    if (firstBranch) return firstBranch;
  }
  return undefined;
}

function objectFixture(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : [];
  return Object.fromEntries(
    required.map((name) => [
      name,
      valueFixture(isRecord(properties[name]) ? properties[name] : {}),
    ]),
  );
}

function toolResult(
  structuredContent: Record<string, unknown>,
  isError = false,
): {
  isError?: true;
  content: [{type: 'text'; text: string}];
  structuredContent: Record<string, unknown>;
} {
  return {
    ...(isError ? {isError: true as const} : {}),
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
