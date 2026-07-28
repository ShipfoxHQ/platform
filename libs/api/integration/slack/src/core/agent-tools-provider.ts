import type {
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {SlackApiClient, SlackWebApiResponse} from '#api/client.js';
import {
  SLACK_TOOL_OPERATIONS,
  type SlackAgentToolCatalogEntry,
  type SlackAgentToolId,
  type SlackAgentToolRequiredScope,
  type SlackToolOperation,
  slackAgentToolCatalog,
  slackAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {SlackIntegrationProviderError} from '#core/errors.js';
import type {SlackTokenStore} from '#core/tokens.js';

type SlackIntegrationConnection = IntegrationConnection<'slack'>;

export type SlackToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface SlackAgentToolsProviderOptions {
  slack: Pick<SlackApiClient, 'callMethod'>;
  tokenStore: Pick<SlackTokenStore, 'getAccessToken'>;
}

export class SlackAgentToolsProvider
  implements
    AgentToolsProvider<
      SlackIntegrationConnection,
      SlackAgentToolRequiredScope,
      unknown,
      SlackToolCallResult
    >
{
  constructor(private readonly options: SlackAgentToolsProviderOptions) {}

  catalog() {
    return slackAgentToolCatalog;
  }

  selectionCatalog() {
    return slackAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<
      SlackIntegrationConnection,
      SlackAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<SlackToolCallResult>> {
    const token = await this.options.tokenStore.getAccessToken({connectionId: input.connection.id});

    return {
      call: async (call) => {
        const tool = input.tools.find((candidate) => candidate.id === call.toolId);
        if (!tool) return slackToolError(`Unknown Slack tool: ${call.toolId}`);
        const operation = slackToolOperation(tool.id);
        if (!operation) return slackToolError(`Unknown Slack tool method: ${tool.id}`);
        const missingParameter = missingRequiredParameter(tool, call.arguments);
        if (missingParameter) {
          return slackToolError(`Missing required parameter: ${missingParameter}`);
        }

        let body: SlackWebApiResponse;
        try {
          body = await this.options.slack.callMethod({
            method: operation.method,
            token,
            arguments: operation.mapArguments(call.arguments),
          });
        } catch (error) {
          if (error instanceof SlackIntegrationProviderError) {
            return slackToolError(error.message, {
              code: error.reason,
              retryAfterSeconds: error.retryAfterSeconds,
            });
          }
          throw error;
        }

        if (body.ok) {
          return slackToolResult(operation.mapOutput?.(body, call.arguments) ?? body);
        }
        const slackError = typeof body.error === 'string' ? body.error : 'Slack request failed';
        if (isSlackAccessError(slackError)) {
          logger().warn(
            {connectionId: input.connection.id, slackError},
            'Slack API rejected integration credentials',
          );
          return slackToolError(slackError, {code: 'access-denied'});
        }
        if (slackError === 'ratelimited') {
          return slackToolError(slackError, {code: 'rate-limited'});
        }
        return slackToolError(slackError);
      },
      close: () => Promise.resolve(),
    };
  }
}

function slackToolOperation(toolId: string): SlackToolOperation | undefined {
  return SLACK_TOOL_OPERATIONS[toolId as SlackAgentToolId];
}

function missingRequiredParameter(
  tool: SlackAgentToolCatalogEntry,
  args: Record<string, unknown>,
): string | undefined {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return undefined;
  return required.find((parameter) => typeof parameter === 'string' && !(parameter in args));
}

function isSlackAccessError(error: string): boolean {
  return error === 'invalid_auth' || error === 'token_revoked' || error === 'account_inactive';
}

function slackToolResult(body: SlackWebApiResponse): SlackToolCallResult {
  return {
    content: [{type: 'text', text: JSON.stringify(body)}],
    structuredContent: body,
  };
}

function slackToolError(
  message: string,
  options: {code?: string | undefined; retryAfterSeconds?: number | undefined} = {},
): SlackToolCallResult {
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
