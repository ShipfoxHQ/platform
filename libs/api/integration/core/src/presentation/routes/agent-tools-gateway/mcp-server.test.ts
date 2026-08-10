import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {
  catalogTool,
  connection,
  materializedIntegration,
  materializedTool,
} from '#test/agent-tools-gateway-helpers.js';
import {INVALID_METHOD_LABEL, NO_METHOD_LABEL} from './audit.js';
import {buildAgentToolsMcpServer, type IntegrationToolDispatchInput} from './mcp-server.js';
import type {AuthorizedIntegrationToolMap} from './resolve-authorized-tools.js';

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
