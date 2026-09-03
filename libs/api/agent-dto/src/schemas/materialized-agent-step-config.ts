import {
  agentThinkingSchema,
  agentToolSurfaceSchema,
  DEFAULT_HARNESS,
  harnessSchema,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import {modelProviderRefSchema} from './model-provider-id.js';
import {agentSessionDescriptorSchema} from './session-transcript.js';

const agentToolSensitivitySchema = z.enum(['read', 'write']);
const agentToolJsonSchema = z.record(z.string(), z.unknown());
const agentToolRequiredScopeSchema = z.array(z.unknown());

export const materializedAgentIntegrationToolMethodSchema = z.strictObject({
  id: z.string().min(1),
  token: z.string().min(1),
  description: z.string().min(1).optional(),
  sensitivity: agentToolSensitivitySchema,
  sensitive: z.boolean(),
  requiredScope: agentToolRequiredScopeSchema,
});

export const materializedAgentIntegrationToolSchema = z.strictObject({
  id: z.string().min(1),
  sensitivity: agentToolSensitivitySchema,
  sensitive: z.boolean(),
  requiredScope: agentToolRequiredScopeSchema,
  inputSchema: agentToolJsonSchema,
  outputSchema: agentToolJsonSchema.optional(),
  methods: z.array(materializedAgentIntegrationToolMethodSchema).min(1).optional(),
});

export const materializedAgentIntegrationSchema = z.strictObject({
  connectionId: z.string().min(1),
  connectionSlug: z.string().min(1),
  provider: z.string().min(1),
  requiredScope: agentToolRequiredScopeSchema,
  tools: z.array(materializedAgentIntegrationToolSchema).min(1),
});

export const AGENT_INTEGRATION_MCP_SERVER_NAME = 'shipfox_integration_tools';
export const AGENT_INTEGRATION_MCP_ENDPOINT = '/runs/jobs/current/integration-tools/mcp';
export const AGENT_INTEGRATION_MCP_TRANSPORT = 'http';
export const AGENT_INTEGRATION_MCP_AUTH = 'lease_token';

/** The namespaced MCP name shared by the gateway and runner transports. */
export function agentIntegrationMcpToolName(connectionSlug: string, toolId: string): string {
  return `${sanitizeAgentIntegrationConnectionSlug(connectionSlug)}__${toolId}`;
}

export function sanitizeAgentIntegrationConnectionSlug(slug: string): string {
  return slug.replaceAll('-', '_');
}

export const agentIntegrationMcpServerSchema = z.strictObject({
  name: z.literal(AGENT_INTEGRATION_MCP_SERVER_NAME),
  transport: z.literal(AGENT_INTEGRATION_MCP_TRANSPORT),
  endpoint: z.literal(AGENT_INTEGRATION_MCP_ENDPOINT),
  auth: z.literal(AGENT_INTEGRATION_MCP_AUTH),
  integrations: z.array(materializedAgentIntegrationSchema).min(1),
});

export const materializedAgentStepConfigSchema = z
  .object({
    harness: harnessSchema.default(DEFAULT_HARNESS),
    provider: modelProviderRefSchema,
    model: z.string().min(1),
    thinking: agentThinkingSchema,
    tools: z.array(z.string().min(1)).min(1).optional(),
    toolSurface: agentToolSurfaceSchema.optional(),
    integrations: z.array(materializedAgentIntegrationSchema).min(1).optional(),
    mcpServers: z.array(agentIntegrationMcpServerSchema).length(1).optional(),
    prompt: z.string(),
    session: agentSessionDescriptorSchema.optional(),
  })
  .strip();

export type MaterializedAgentStepConfigDto = z.infer<typeof materializedAgentStepConfigSchema>;
export type MaterializedAgentIntegrationConfigDto = z.infer<
  typeof materializedAgentIntegrationSchema
>;
export type MaterializedAgentIntegrationToolConfigDto = z.infer<
  typeof materializedAgentIntegrationToolSchema
>;
export type AgentIntegrationMcpServerConfigDto = z.infer<typeof agentIntegrationMcpServerSchema>;
