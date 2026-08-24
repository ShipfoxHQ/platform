import type {
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaIssue, GiteaIssueComment} from '#api/client.js';
import {
  GITEA_TOOL_OPERATIONS,
  type GiteaAgentToolId,
  type GiteaAgentToolRequiredScope,
  type GiteaToolOperation,
  giteaAgentToolCatalog,
  giteaAgentToolSelectionCatalog,
  validateGiteaToolArguments,
} from '#core/agent-tools.js';

type GiteaIntegrationConnection = IntegrationConnection<'gitea'>;

export type GiteaToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface GiteaAgentToolsProviderOptions {
  gitea: Pick<GiteaApiClient, 'getIssue' | 'createIssueComment'>;
}

export class GiteaAgentToolsProvider
  implements
    AgentToolsProvider<
      GiteaIntegrationConnection,
      GiteaAgentToolRequiredScope,
      unknown,
      GiteaToolCallResult
    >
{
  constructor(private readonly options: GiteaAgentToolsProviderOptions) {}

  catalog() {
    return giteaAgentToolCatalog;
  }

  selectionCatalog() {
    return giteaAgentToolSelectionCatalog;
  }

  openSession(
    input: OpenAgentToolsSessionInput<
      GiteaIntegrationConnection,
      GiteaAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<GiteaToolCallResult>> {
    // The service token is instance-wide, so every call is scoped to the
    // connection's own account; the owner is never a tool input.
    const owner = input.connection.externalAccountId;

    return Promise.resolve({
      call: async (call) => {
        const tool = input.tools.find((candidate) => candidate.id === call.toolId);
        if (!tool) return giteaToolError(`Unknown Gitea tool: ${call.toolId}`, 'invalid-request');
        const operation = giteaToolOperation(tool.id);
        if (!operation)
          return giteaToolError(`Unknown Gitea tool method: ${tool.id}`, 'invalid-request');
        const validationError = validateGiteaToolArguments(tool, call.arguments);
        if (validationError) return giteaToolError(validationError, 'invalid-request');

        const result: GiteaIssue | GiteaIssueComment =
          operation.method === 'getIssue'
            ? await this.options.gitea.getIssue(operation.mapArguments(call.arguments, owner))
            : await this.options.gitea.createIssueComment(
                operation.mapArguments(call.arguments, owner),
              );

        return giteaToolResult(result);
      },
      close: () => Promise.resolve(),
    });
  }
}

function giteaToolOperation(toolId: string): GiteaToolOperation | undefined {
  return GITEA_TOOL_OPERATIONS[toolId as GiteaAgentToolId];
}

function giteaToolResult(body: GiteaIssue | GiteaIssueComment): GiteaToolCallResult {
  return {
    content: [{type: 'text', text: JSON.stringify(body)}],
    structuredContent: {...body},
  };
}

function giteaToolError(message: string, code: string): GiteaToolCallResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent: {code},
  };
}
