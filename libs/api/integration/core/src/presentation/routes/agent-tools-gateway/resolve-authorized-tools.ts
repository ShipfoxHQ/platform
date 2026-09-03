import {
  agentIntegrationMcpToolName,
  type MaterializedAgentIntegrationConfigDto,
  type MaterializedAgentIntegrationToolConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import {requireLeasedJobContext} from '@shipfox/api-auth-context';
import {
  type WorkflowsModuleClient,
  workflowsInterModuleContract,
} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionProviderChangedError,
  IntegrationConnectionWorkspaceMismatchError,
} from '#core/errors.js';
import type {AgentToolCatalogEntry, AgentToolJsonSchema} from '#core/providers/agent-tools.js';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {loadAuthorizedToolConnection} from '#core/tool-call-service.js';
import type {GetIntegrationConnectionByIdFn} from '#db/connections.js';

export type LeasedAgentStepLoader = (params: {
  request: object;
  stepId: string;
  attempt: number;
}) => Promise<{
  workspaceId: string;
  integrations?: MaterializedAgentIntegrationConfigDto[];
  step?: {type: string; config: Record<string, unknown>};
}>;

export function createWorkflowsLeasedAgentStepLoader(
  workflows: WorkflowsModuleClient,
): LeasedAgentStepLoader {
  return async ({request, stepId, attempt}) => {
    const leasedJob = requireLeasedJobContext(request);
    try {
      const context = await workflows.getLeasedAgentToolContext({
        jobId: leasedJob.jobId,
        jobExecutionId: leasedJob.jobExecutionId,
        runnerSessionId: leasedJob.runnerSessionId,
        stepId,
        attempt,
      });
      return {
        workspaceId: context.workspaceId,
        integrations: context.integrations,
      };
    } catch (error) {
      throw toLeasedAgentToolClientError(error);
    }
  };
}

function toLeasedAgentToolClientError(error: unknown): unknown {
  const method = workflowsInterModuleContract.methods.getLeasedAgentToolContext;
  if (!isInterModuleKnownError(method, error)) return error;

  const status = [
    'step-attempt-mismatch',
    'step-not-running',
    'leased-step-not-agent',
    'agent-step-config-invalid',
  ].includes(error.code)
    ? 409
    : 404;
  return new ClientError(error.code.replaceAll('-', ' '), error.code, {status});
}

export interface AuthorizedIntegrationTool {
  mcpName: string;
  integration: MaterializedAgentIntegrationConfigDto;
  tool: MaterializedAgentIntegrationToolConfigDto;
  connection: IntegrationConnection;
  description: string;
  inputSchema: AgentToolJsonSchema;
  outputSchema?: AgentToolJsonSchema | undefined;
  /** Live catalog entry used for repository classification at dispatch time. */
  catalogEntry?: AgentToolCatalogEntry | undefined;
}

export type AuthorizedIntegrationToolMap = Map<string, AuthorizedIntegrationTool>;

export interface ResolveAuthorizedToolsParams {
  request: object;
  loadLeasedAgentStep: LeasedAgentStepLoader;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export async function resolveAuthorizedIntegrationTools(
  params: ResolveAuthorizedToolsParams,
): Promise<AuthorizedIntegrationToolMap> {
  const leasedJob = requireLeasedJobContext(params.request);
  if (!leasedJob.currentStepId || leasedJob.currentStepAttempt === undefined) {
    throw new ClientError('Lease does not identify a current step', 'lease-missing-step', {
      status: 409,
    });
  }

  const loaded = await params.loadLeasedAgentStep({
    request: params.request,
    stepId: leasedJob.currentStepId,
    attempt: leasedJob.currentStepAttempt,
  });
  const workspaceId = loaded.workspaceId;
  const integrations = loaded.integrations ?? legacyIntegrations(loaded.step);
  const authorizedTools: AuthorizedIntegrationToolMap = new Map();

  for (const integration of integrations) {
    const connection = await loadAuthorizedConnection({
      integration,
      workspaceId,
      registry: params.registry,
      getIntegrationConnectionById: params.getIntegrationConnectionById,
    });
    const catalog = await params.registry.getAdapter(integration.provider, 'agent_tools').catalog();
    const catalogByToolId = new Map(catalog.map((entry) => [entry.id, entry]));

    for (const tool of integration.tools) {
      addAuthorizedTool(
        authorizedTools,
        integration,
        tool,
        connection,
        catalogByToolId.get(tool.id),
      );
    }
  }

  return authorizedTools;
}

function addAuthorizedTool(
  authorizedTools: AuthorizedIntegrationToolMap,
  integration: MaterializedAgentIntegrationConfigDto,
  tool: MaterializedAgentIntegrationToolConfigDto,
  connection: IntegrationConnection,
  catalogTool: AgentToolCatalogEntry | undefined,
): void {
  const mcpName = agentIntegrationMcpToolName(integration.connectionSlug, tool.id);
  if (authorizedTools.has(mcpName)) {
    throw new ClientError(
      'Integration tool names collide after MCP namespacing',
      'integration-tool-name-collision',
      {status: 409},
    );
  }

  authorizedTools.set(mcpName, {
    mcpName,
    integration,
    tool,
    connection,
    // Live catalog metadata supplies dispatch classification; frozen step config remains the allowlist.
    description: catalogTool?.description ?? tool.id,
    inputSchema: toolInputSchema(tool),
    outputSchema: tool.outputSchema ?? catalogTool?.outputSchema,
    ...(catalogTool === undefined ? {} : {catalogEntry: catalogTool}),
  });
}

function legacyIntegrations(step: {type: string; config: Record<string, unknown>} | undefined) {
  if (step?.type !== 'agent') {
    throw new ClientError('Current leased step is not an agent step', 'leased-step-not-agent', {
      status: 409,
    });
  }
  try {
    return materializedAgentStepConfigSchema.parse(step.config).integrations ?? [];
  } catch (error) {
    throw new ClientError('Agent step config is invalid', 'agent-step-config-invalid', {
      status: 409,
      cause: error,
    });
  }
}

export function narrowMethodEnum(
  inputSchema: AgentToolJsonSchema,
  authorizedMethods: readonly string[],
): AgentToolJsonSchema {
  const schema = cloneSchema(inputSchema);
  const methodSchema = getObjectProperty(schema, 'method');
  if (methodSchema) {
    narrowEnumOrConst(methodSchema, authorizedMethods);
  }

  // Claude rejects MCP tools with a top-level oneOf. The narrowed method enum remains the
  // authority boundary, while provider validation enforces method-specific argument shapes.
  delete schema.oneOf;

  return schema;
}

function toolInputSchema(tool: MaterializedAgentIntegrationToolConfigDto): AgentToolJsonSchema {
  const authorizedMethods = tool.methods?.map((method) => method.id) ?? [];
  return narrowMethodEnum(tool.inputSchema, authorizedMethods);
}

async function loadAuthorizedConnection(params: {
  integration: MaterializedAgentIntegrationConfigDto;
  workspaceId: string;
  registry: IntegrationProviderRegistry;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}): Promise<IntegrationConnection> {
  try {
    return await loadAuthorizedToolConnection({
      workspaceId: params.workspaceId,
      connectionId: params.integration.connectionId,
      provider: params.integration.provider,
      registry: params.registry,
      getIntegrationConnectionById: params.getIntegrationConnectionById,
    });
  } catch (error) {
    if (error instanceof IntegrationConnectionNotFoundError) {
      throw unavailable('Integration connection is no longer available');
    }
    if (error instanceof IntegrationConnectionWorkspaceMismatchError) {
      throw unavailable('Integration connection does not belong to the leased workspace');
    }
    if (error instanceof IntegrationConnectionInactiveError) {
      throw unavailable('Integration connection is not active');
    }
    if (error instanceof IntegrationConnectionProviderChangedError) {
      throw unavailable('Integration connection provider changed');
    }
    if (error instanceof IntegrationCapabilityUnavailableError) {
      throw unavailable('Integration provider no longer exposes agent tools');
    }
    throw error;
  }
}

function unavailable(message: string): ClientError {
  return new ClientError(message, 'integration-tool-connection-unavailable', {status: 409});
}

function cloneSchema(schema: AgentToolJsonSchema): AgentToolJsonSchema {
  return structuredClone(schema);
}

function getObjectProperty(
  schema: AgentToolJsonSchema,
  property: string,
): AgentToolJsonSchema | null {
  const properties = schema.properties;
  if (!isRecord(properties)) return null;
  const value = properties[property];
  return isRecord(value) ? value : null;
}

function narrowEnumOrConst(
  schema: AgentToolJsonSchema,
  authorizedMethods: readonly string[],
): void {
  if (Array.isArray(schema.enum)) {
    schema.enum = schema.enum.filter(
      (value): value is string => typeof value === 'string' && authorizedMethods.includes(value),
    );
  }
  if (typeof schema.const === 'string' && !authorizedMethods.includes(schema.const)) {
    delete schema.const;
  }
}

function isRecord(value: unknown): value is AgentToolJsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
