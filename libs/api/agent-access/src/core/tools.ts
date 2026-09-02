import {
  type AgentAccessEnvelopeDto,
  type AgentAccessObjectSchema,
  agentAccessOutputSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {AGENT_ACCESS_FIXTURE_TOOL_NAME} from '#constants.js';
import {agentAccessError, agentAccessSuccess} from './envelope.js';

export interface AgentAccessToolCall {
  context: AgentAccessContext;
  arguments: Record<string, unknown>;
}

export interface AgentAccessTool {
  name: string;
  description: string;
  inputSchema: AgentAccessObjectSchema;
  outputSchema: AgentAccessObjectSchema;
  validateInput?: ((input: unknown) => boolean) | undefined;
  annotations: {readonly readOnlyHint: true};
  execute: (call: AgentAccessToolCall) => Promise<AgentAccessEnvelopeDto> | AgentAccessEnvelopeDto;
  validateResult?: ((result: unknown) => boolean) | undefined;
}

export type AgentAccessToolMap = ReadonlyMap<string, AgentAccessTool>;

export function createAgentAccessToolMap(tools: readonly AgentAccessTool[]): AgentAccessToolMap {
  const table = new Map<string, AgentAccessTool>();
  for (const tool of tools) {
    if (table.has(tool.name)) throw new Error(`Duplicate agent-access tool: ${tool.name}`);
    table.set(tool.name, tool);
  }
  return table;
}

/** A deterministic tool used by gateway contract tests; no production tool is registered here. */
export function createAgentAccessFixtureTool(): AgentAccessTool {
  return {
    name: AGENT_ACCESS_FIXTURE_TOOL_NAME,
    description: 'Return a deterministic response from the dormant agent-access gateway fixture.',
    inputSchema: {
      type: 'object',
      properties: {message: {type: 'string', maxLength: 256}},
      required: ['message'],
      additionalProperties: false,
    },
    outputSchema: agentAccessOutputSchema({
      type: 'object',
      properties: {message: {type: 'string'}},
      required: ['message'],
      additionalProperties: false,
    }),
    annotations: {readOnlyHint: true},
    execute: ({arguments: input}) => {
      const message = input.message;
      if (
        Object.keys(input).some((key) => key !== 'message') ||
        typeof message !== 'string' ||
        [...message].length > 256
      ) {
        return agentAccessError('invalid-request', {
          message: 'message must be a string of at most 256 characters with no extra properties',
        });
      }
      return agentAccessSuccess({message});
    },
  };
}
