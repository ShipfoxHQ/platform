import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
  agentIntegrationMcpToolName,
  materializedAgentStepConfigSchema,
  sanitizeAgentIntegrationConnectionSlug,
} from './materialized-agent-step-config.js';

const materializedIntegration = {
  connectionId: 'connection-1',
  connectionSlug: 'github-main',
  provider: 'github',
  requiredScope: [{permission: 'issues', access: 'write'}],
  tools: [
    {
      id: 'issue_read',
      sensitivity: 'read',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'read'}],
      inputSchema: {type: 'object'},
      methods: [
        {
          id: 'get',
          token: 'issue_read.get',
          description: 'Get issue.',
          sensitivity: 'read',
          sensitive: false,
          requiredScope: [{permission: 'issues', access: 'read'}],
        },
      ],
    },
    {
      id: 'issue_write',
      sensitivity: 'write',
      sensitive: false,
      requiredScope: [{permission: 'issues', access: 'write'}],
      inputSchema: {type: 'object'},
      outputSchema: {type: 'object'},
      methods: [
        {
          id: 'create',
          token: 'issue_write.create',
          description: 'Create issue.',
          sensitivity: 'write',
          sensitive: false,
          requiredScope: [{permission: 'issues', access: 'write'}],
        },
      ],
    },
  ],
} as const;

const integrationMcpServer = {
  name: AGENT_INTEGRATION_MCP_SERVER_NAME,
  transport: AGENT_INTEGRATION_MCP_TRANSPORT,
  endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
  auth: AGENT_INTEGRATION_MCP_AUTH,
  integrations: [materializedIntegration],
} as const;

describe('materializedAgentStepConfigSchema', () => {
  it('accepts a materialized agent step config', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      tools: ['read', 'web_search'],
      toolSurface: 'discovery',
      integrations: [materializedIntegration],
      mcpServers: [integrationMcpServer],
      prompt: 'Fix the failing tests.',
    });

    expect(parsed).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      tools: ['read', 'web_search'],
      toolSurface: 'discovery',
      integrations: [materializedIntegration],
      mcpServers: [integrationMcpServer],
      prompt: 'Fix the failing tests.',
    });
  });

  it('accepts a custom provider ref', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'local-vllm',
      model: 'llama-3.1',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed.provider).toBe('local-vllm');
  });

  it('defaults a missing harness for stored materialized configs', () => {
    const parsed = materializedAgentStepConfigSchema.parse({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });

    expect(parsed.harness).toBe('pi');
  });

  it('rejects missing fields and strips extra fields', () => {
    const missingField = () =>
      materializedAgentStepConfigSchema.parse({
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        prompt: 'Fix the failing tests.',
      });
    const extraField = materializedAgentStepConfigSchema.parse({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
      gate: {success: 'ok'},
    });

    expect(missingField).toThrow();
    expect(extraField).toEqual({
      harness: 'pi',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    });
  });

  it('rejects malformed tools', () => {
    const emptyTools = () =>
      materializedAgentStepConfigSchema.parse({
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        tools: [],
        prompt: 'Fix the failing tests.',
      });

    expect(emptyTools).toThrow();
  });

  it('rejects malformed integrations', () => {
    const emptyTools = () =>
      materializedAgentStepConfigSchema.parse({
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        integrations: [
          {
            connectionId: 'connection-1',
            connectionSlug: 'github-main',
            provider: 'github',
            requiredScope: [],
            tools: [],
          },
        ],
        prompt: 'Fix the failing tests.',
      });

    expect(emptyTools).toThrow();
  });

  it.each([
    ['empty integrations', {...integrationMcpServer, integrations: []}],
    ['wrong auth', {...integrationMcpServer, auth: 'provider_token'}],
    ['wrong transport', {...integrationMcpServer, transport: 'stdio'}],
    ['missing endpoint', omit(integrationMcpServer, 'endpoint')],
    ['missing name', omit(integrationMcpServer, 'name')],
  ])('rejects malformed integration MCP server config for %s', (_caseName, mcpServer) => {
    const parse = () =>
      materializedAgentStepConfigSchema.parse({
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        integrations: [materializedIntegration],
        mcpServers: [mcpServer],
        prompt: 'Fix the failing tests.',
      });

    expect(parse).toThrow();
  });
});

describe('agentIntegrationMcpToolName', () => {
  it('uses the gateway namespace for sanitized connection slugs', () => {
    expect(sanitizeAgentIntegrationConnectionSlug('github-main')).toBe('github_main');
    expect(agentIntegrationMcpToolName('github-main', 'issue_read')).toBe(
      'github_main__issue_read',
    );
  });
});

function omit<T extends object, K extends keyof T>(object: T, key: K): Omit<T, K> {
  const copy = {...object};
  delete copy[key];
  return copy;
}
