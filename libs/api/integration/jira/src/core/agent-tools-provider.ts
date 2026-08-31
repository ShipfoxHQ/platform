import type {
  AgentToolCatalogEntry,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {JiraAgentToolResponse, JiraAgentToolsClient} from '#api/client.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {
  JIRA_TOOL_OPERATIONS,
  type JiraAgentToolRequiredScope,
  jiraAgentToolCatalog,
  jiraAgentToolSelectionCatalog,
} from './agent-tools.js';
import {JiraIntegrationProviderError} from './errors.js';

type JiraIntegrationConnection = IntegrationConnection<'jira'>;
type JiraToolCall = Parameters<AgentToolSession<JiraToolCallResult>['call']>[0];

export type JiraToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface JiraAgentToolsProviderOptions {
  jira: Pick<JiraAgentToolsClient, 'request'>;
  tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
}

export class JiraAgentToolsProvider
  implements
    AgentToolsProvider<
      JiraIntegrationConnection,
      JiraAgentToolRequiredScope,
      unknown,
      JiraToolCallResult
    >
{
  constructor(private readonly options: JiraAgentToolsProviderOptions) {}

  catalog() {
    return jiraAgentToolCatalog;
  }

  selectionCatalog() {
    return jiraAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<
      JiraIntegrationConnection,
      JiraAgentToolRequiredScope,
      unknown
    >,
  ): Promise<AgentToolSession<JiraToolCallResult>> {
    const accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: input.connection.id,
    });
    const cloudId = input.connection.externalAccountId;

    return {
      call: (call) =>
        executeJiraToolCall({
          call,
          tools: input.tools,
          accessToken,
          cloudId,
          jira: this.options.jira,
        }),
      close: () => Promise.resolve(),
    };
  }
}

async function executeJiraToolCall(params: {
  call: JiraToolCall;
  tools: readonly AgentToolCatalogEntry<JiraAgentToolRequiredScope>[];
  accessToken: string;
  cloudId: string;
  jira: Pick<JiraAgentToolsClient, 'request'>;
}): Promise<JiraToolCallResult> {
  const tool = params.tools.find((candidate) => candidate.id === params.call.toolId);
  if (!tool) return jiraToolError(`Unknown Jira tool: ${params.call.toolId}`);
  const operation = JIRA_TOOL_OPERATIONS[params.call.toolId as keyof typeof JIRA_TOOL_OPERATIONS];
  if (!operation) return jiraToolError(`Unknown Jira tool: ${params.call.toolId}`);
  const missingParameter = missingRequiredParameter(tool, params.call.arguments);
  if (missingParameter) return jiraToolError(`Missing required parameter: ${missingParameter}`);

  const response = await requestJiraTool({
    ...params,
    operation,
  });
  if (response instanceof JiraIntegrationProviderError) {
    return jiraToolError(response.message, {
      code: response.reason,
      retryAfterSeconds: response.retryAfterSeconds,
    });
  }
  return mapJiraToolResponse(response);
}

async function requestJiraTool(params: {
  call: JiraToolCall;
  accessToken: string;
  cloudId: string;
  jira: Pick<JiraAgentToolsClient, 'request'>;
  operation: (typeof JIRA_TOOL_OPERATIONS)[keyof typeof JIRA_TOOL_OPERATIONS];
}): Promise<JiraAgentToolResponse | JiraIntegrationProviderError> {
  try {
    return await params.jira.request({
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      method: params.operation.method,
      path: params.operation.path(params.call.arguments),
      ...(params.operation.query === undefined
        ? {}
        : {query: params.operation.query(params.call.arguments)}),
      ...(params.operation.body === undefined
        ? {}
        : {body: params.operation.body(params.call.arguments)}),
      operation: params.call.toolId,
    });
  } catch (error) {
    if (error instanceof JiraIntegrationProviderError) return error;
    throw error;
  }
}

function mapJiraToolResponse(response: JiraAgentToolResponse): JiraToolCallResult {
  if (response.status === 400 || response.status === 404) {
    return jiraRequestError(
      response.body,
      response.status === 404 ? 'Jira resource was not found' : 'Jira request was rejected',
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return jiraToolError(`Jira request returned HTTP ${response.status}`);
  }
  return jiraToolResult(response.body, response.status);
}

function missingRequiredParameter(
  tool: AgentToolCatalogEntry<JiraAgentToolRequiredScope>,
  args: Record<string, unknown>,
): string | undefined {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return undefined;
  return required.find(
    (parameter) => typeof parameter === 'string' && args[parameter] === undefined,
  );
}

function jiraToolResult(body: unknown, status: number): JiraToolCallResult {
  let structuredContent: Record<string, unknown> = {status};
  if (isRecord(body)) structuredContent = body;
  else if (body !== undefined) structuredContent = {result: body};
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function jiraRequestError(body: unknown, fallbackMessage: string): JiraToolCallResult {
  return jiraToolError(jiraErrorMessage(body, fallbackMessage));
}

function jiraErrorMessage(body: unknown, fallbackMessage: string): string {
  if (typeof body === 'string' && body.length > 0) return body;
  if (!isRecord(body)) return fallbackMessage;

  const errorMessages = body.errorMessages;
  if (Array.isArray(errorMessages)) {
    const message = errorMessages.filter((value): value is string => typeof value === 'string');
    if (message.length > 0) return message.join('; ');
  }
  if (typeof body.message === 'string' && body.message.length > 0) return body.message;
  const errors = body.errors;
  if (isRecord(errors)) {
    const messages = Object.entries(errors).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (messages.length > 0)
      return messages.map(([field, message]) => `${field}: ${message}`).join('; ');
  }
  return fallbackMessage;
}

function jiraToolError(
  message: string,
  options: {code?: string | undefined; retryAfterSeconds?: number | undefined} = {},
): JiraToolCallResult {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
