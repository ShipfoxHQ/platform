import type {
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {GiteaApiClient, GiteaIssue, GiteaIssueComment} from '#api/client.js';
import {
  GITEA_TOOL_OPERATIONS,
  type GiteaAgentToolCatalogEntry,
  type GiteaAgentToolId,
  type GiteaAgentToolRequiredScope,
  type GiteaToolOperation,
  giteaAgentToolCatalog,
  giteaAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {GiteaIntegrationProviderError} from '#core/errors.js';

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
        if (!tool) return giteaToolError(`Unknown Gitea tool: ${call.toolId}`);
        const operation = giteaToolOperation(tool.id);
        if (!operation) return giteaToolError(`Unknown Gitea tool method: ${tool.id}`);
        const missingParameter = missingRequiredParameter(tool, call.arguments);
        if (missingParameter) {
          return giteaToolError(`Missing required parameter: ${missingParameter}`);
        }

        let result: GiteaIssue | GiteaIssueComment;
        try {
          result =
            operation.method === 'getIssue'
              ? await this.options.gitea.getIssue(operation.mapArguments(call.arguments, owner))
              : await this.options.gitea.createIssueComment(
                  operation.mapArguments(call.arguments, owner),
                );
        } catch (error) {
          if (error instanceof GiteaIntegrationProviderError) {
            return giteaToolError(error.message, {
              code: error.reason,
              retryAfterSeconds: error.retryAfterSeconds,
            });
          }
          throw error;
        }

        return giteaToolResult(result);
      },
      close: () => Promise.resolve(),
    });
  }
}

function giteaToolOperation(toolId: string): GiteaToolOperation | undefined {
  return GITEA_TOOL_OPERATIONS[toolId as GiteaAgentToolId];
}

function missingRequiredParameter(
  tool: GiteaAgentToolCatalogEntry,
  args: Record<string, unknown>,
): string | undefined {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return undefined;
  return required.find((parameter) => typeof parameter === 'string' && !(parameter in args));
}

function giteaToolResult(body: GiteaIssue | GiteaIssueComment): GiteaToolCallResult {
  return {
    content: [{type: 'text', text: JSON.stringify(body)}],
    structuredContent: {...body},
  };
}

function giteaToolError(
  message: string,
  options: {code?: string | undefined; retryAfterSeconds?: number | undefined} = {},
): GiteaToolCallResult {
  const structuredContent = {
    ...(options.code === undefined ? {} : {code: options.code}),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : {retryAfterSeconds: options.retryAfterSeconds}),
  };
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    ...(Object.keys(structuredContent).length === 0 ? {} : {structuredContent}),
  };
}
