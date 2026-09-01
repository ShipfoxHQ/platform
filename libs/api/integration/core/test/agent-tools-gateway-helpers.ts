import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import type {LeasedJobContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '#core/entities/connection.js';
import type {
  AgentToolCatalogEntry,
  AgentToolRepositoryAuthorizationState,
  AgentToolsProvider,
} from '#core/providers/agent-tools.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';

export function leaseContext(overrides: Partial<LeasedJobContext> = {}): LeasedJobContext {
  const now = Math.floor(Date.now() / 1000);
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    runnerSessionId: crypto.randomUUID(),
    currentStepId: crypto.randomUUID(),
    currentStepAttempt: 1,
    aud: 'runner-job-lease',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

export function connection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    externalAccountId: 'installation-1',
    slug: 'github-main',
    displayName: 'GitHub',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function materializedTool(
  overrides: Partial<MaterializedAgentIntegrationToolConfigDto> = {},
): MaterializedAgentIntegrationToolConfigDto {
  return {
    id: 'issue_read',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        method: {
          type: 'string',
          enum: ['get', 'get_comments', 'get_labels'],
        },
        owner: {type: 'string'},
        repo: {type: 'string'},
        issue_number: {type: 'integer'},
      },
      required: ['method', 'owner', 'repo', 'issue_number'],
      oneOf: [
        {properties: {method: {const: 'get'}}, required: ['issue_number']},
        {properties: {method: {const: 'get_comments'}}, required: ['issue_number']},
        {properties: {method: {const: 'get_labels'}}, required: ['issue_number']},
      ],
    },
    methods: [
      {
        id: 'get',
        token: 'issue_read.get',
        description: 'Get one issue.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [],
      },
      {
        id: 'get_comments',
        token: 'issue_read.get_comments',
        description: 'Get issue comments.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [],
      },
    ],
    ...overrides,
  };
}

export function materializedIntegration(
  overrides: Partial<MaterializedAgentIntegrationConfigDto> = {},
): MaterializedAgentIntegrationConfigDto {
  return {
    connectionId: crypto.randomUUID(),
    connectionSlug: 'github-main',
    provider: 'github',
    requiredScope: [],
    tools: [materializedTool()],
    ...overrides,
  };
}

export function agentStepConfig(
  integrations: MaterializedAgentIntegrationConfigDto[] = [materializedIntegration()],
): Record<string, unknown> {
  return {
    provider: 'openai',
    model: 'gpt-5',
    thinking: 'off',
    prompt: 'Use tools',
    integrations,
  };
}

export function catalogTool(overrides: Partial<AgentToolCatalogEntry> = {}): AgentToolCatalogEntry {
  return {
    id: 'issue_read',
    description: 'Read issue metadata from GitHub.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: [],
    inputSchema: {type: 'object', properties: {}, additionalProperties: false},
    outputSchema: {type: 'object', additionalProperties: true},
    methods: [
      {
        id: 'get',
        description: 'Get one issue.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [],
      },
      {
        id: 'get_comments',
        description: 'Get issue comments.',
        sensitivity: 'read',
        sensitive: false,
        requiredScope: [],
      },
    ],
    ...overrides,
  };
}

export interface AgentToolsProviderOptions {
  repositoryAuthorization?: AgentToolRepositoryAuthorizationState | undefined;
  result?: CallToolResult | undefined;
  openSessionError?: unknown;
  callError?: unknown;
  closeError?: unknown;
  onOpenSession?(input: {
    connection: IntegrationConnection;
    tools: readonly AgentToolCatalogEntry[];
  }): void;
  onCall?(input: {toolId: string; arguments: Record<string, unknown>}): void;
  onClose?(): void;
}

export function agentToolsProvider(
  catalog: readonly AgentToolCatalogEntry[] = [catalogTool()],
  options: AgentToolsProviderOptions = {},
): AgentToolsProvider {
  return {
    catalog: () => catalog,
    selectionCatalog: () => ({selectors: []}),
    openSession: (input) => {
      if (options.openSessionError) return Promise.reject(options.openSessionError);
      options.onOpenSession?.({connection: input.connection, tools: input.tools});
      return Promise.resolve({
        call: (call) => {
          options.onCall?.(call);
          if (options.callError) return Promise.reject(options.callError);
          return Promise.resolve(
            options.result ?? {
              content: [{type: 'text', text: 'dispatched'}],
              structuredContent: {
                status: 'dispatched',
                provider: input.connection.provider,
                connection_id: input.connection.id,
                tool_id: call.toolId,
                method: call.arguments.method,
              },
            },
          );
        },
        close: () => {
          options.onClose?.();
          if (options.closeError !== undefined) return Promise.reject(options.closeError);
          return Promise.resolve();
        },
      });
    },
  };
}

export function registryWithAgentTools(
  catalog: readonly AgentToolCatalogEntry[] = [catalogTool()],
  options: AgentToolsProviderOptions = {},
) {
  return createIntegrationProviderRegistry([
    {
      provider: 'github',
      displayName: 'GitHub',
      ...(options.repositoryAuthorization === undefined
        ? {}
        : {repositoryAuthorization: options.repositoryAuthorization}),
      adapters: {
        agent_tools: agentToolsProvider(catalog, options),
      },
    },
  ]);
}
