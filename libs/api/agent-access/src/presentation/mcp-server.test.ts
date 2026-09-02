import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {agentAccessSuccess} from '#core/envelope.js';
import {createAgentAccessTools} from '#core/paged-tools.js';
import {createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {createAgentAccessFixtureTool} from '#core/tools.js';
import {AGENT_ACCESS_PACKAGE_VERSION} from '#version.js';
import {buildAgentAccessMcpServer} from './mcp-server.js';

const context: AgentAccessContext = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: 'grant-1', clientId: 'client-1'},
};

describe('buildAgentAccessMcpServer', () => {
  test('lists only the fixture tool and returns a schema-valid serialized envelope', async () => {
    const {client, close} = await connectClient();

    const tools = await client.listTools();
    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'hello'}},
      CallToolResultSchema,
    );
    await close();

    expect(client.getServerVersion()).toEqual({
      name: 'shipfox',
      version: AGENT_ACCESS_PACKAGE_VERSION,
    });
    expect(tools.tools).toHaveLength(1);
    expect(tools.tools[0]).toMatchObject({
      name: 'agent_access_fixture',
      annotations: {readOnlyHint: true},
      outputSchema: {type: 'object'},
    });
    expect(tools.tools[0]?.outputSchema).not.toHaveProperty('oneOf');
    expect(result.isError).not.toBe(true);
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.content).toEqual([
      {type: 'text', text: JSON.stringify(result.structuredContent)},
    ]);
  });

  test('returns a tool error with retry metadata without raising a JSON-RPC error', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const {client, close} = await connectClient(limiter);

    await client.listTools();
    const first = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'first'}},
      CallToolResultSchema,
    );
    const second = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'second'}},
      CallToolResultSchema,
    );
    await close();

    expect(first.isError).not.toBe(true);
    expect(second.isError).toBe(true);
    expect(second.structuredContent).toEqual({
      ok: false,
      error: {code: 'rate-limited', retry_after_seconds: 60},
    });
    expect(second.content).toEqual([
      {type: 'text', text: JSON.stringify(second.structuredContent)},
    ]);
  });

  test('rejects multibyte input at the MCP boundary before calling a producer', async () => {
    const listWorkflowRuns = vi.fn();
    const tool = createAgentAccessTools({
      projects: {} as unknown as ProjectsModuleClient,
      definitions: {} as unknown as DefinitionsInterModuleClient,
      workflows: {listWorkflowRuns} as unknown as WorkflowsModuleClient,
      annotations: {} as unknown as AnnotationsInterModuleClient,
      triggers: {} as unknown as TriggersInterModuleClient,
    }).find((candidate) => candidate.name === 'list_workflow_runs');
    if (!tool) throw new Error('Expected list_workflow_runs tool');

    const {client, close} = await connectClient(createAgentAccessRateLimiter(), [tool]);
    const result = await client.callTool(
      {
        name: 'list_workflow_runs',
        arguments: {
          project_id: '00000000-0000-4000-8000-000000000001',
          trigger_source: '🙂'.repeat(129),
        },
      },
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(listWorkflowRuns).not.toHaveBeenCalled();
  });

  test('records only the exception when serializing a tool result fails', async () => {
    const recordCall = vi.fn();
    const fixture = createAgentAccessFixtureTool();
    const unserializableTool = {
      ...fixture,
      name: 'unserializable_fixture',
      execute: () => agentAccessSuccess({value: BigInt(1)}),
    };
    const {client, close} = await connectClient(
      createAgentAccessRateLimiter(),
      [unserializableTool],
      recordCall,
    );

    const result = await client.callTool(
      {name: 'unserializable_fixture', arguments: {message: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ok: false, error: {code: 'tool-failed'}});
    expect(recordCall).toHaveBeenCalledTimes(1);
    expect(recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'unserializable_fixture',
        outcome: 'exception',
      }),
    );
  });

  test('returns schema-valid tool errors with the serialized envelope duplicate', async () => {
    const {client, close} = await connectClient();

    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 123}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {
        code: 'invalid-request',
        message: 'message must be a string of at most 256 characters with no extra properties',
      },
    });
    expect(result.content).toEqual([
      {type: 'text', text: JSON.stringify(result.structuredContent)},
    ]);
  });

  test('converts an oversized unpaged success into a bounded content-too-large error', async () => {
    const fixture = createAgentAccessFixtureTool();
    const oversizedTool = {
      ...fixture,
      name: 'oversized_fixture',
      execute: () => agentAccessSuccess({message: 'x'.repeat(128 * 1024)}),
    };
    const {client, close} = await connectClient(createAgentAccessRateLimiter(), [oversizedTool]);

    const result = await client.callTool(
      {name: 'oversized_fixture', arguments: {message: 'ignored'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: {code: 'content-too-large'},
    });
    expect(agentAccessEnvelopeSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  test('does not count tool discovery against the credential window', async () => {
    const limiter = createAgentAccessRateLimiter({limit: 1, now: () => 1_000});
    const {client, close} = await connectClient(limiter);

    await client.listTools();
    const result = await client.callTool(
      {name: 'agent_access_fixture', arguments: {message: 'discovery is free'}},
      CallToolResultSchema,
    );
    await close();

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ok: true});
  });
});

async function connectClient(
  rateLimiter = createAgentAccessRateLimiter(),
  tools = [createAgentAccessFixtureTool()],
  recordCall?: Parameters<typeof buildAgentAccessMcpServer>[0]['recordCall'],
): Promise<{client: Client; close: () => Promise<void>}> {
  const server = buildAgentAccessMcpServer({
    context,
    tools,
    rateLimiter,
    recordCall,
  });
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
