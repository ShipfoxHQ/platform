import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('agent-access');

export type AgentAccessToolCallOutcome =
  | 'success'
  | 'tool-error'
  | 'invalid-request'
  | 'rate-limited'
  | 'exception';

export type AgentAccessAuthFailureReason =
  | 'missing'
  | 'invalid'
  | 'origin-not-allowed'
  | 'dependency-unavailable';

const toolCallCount = meter.createCounter<{
  tool: string;
  outcome: AgentAccessToolCallOutcome;
}>('agent_access_tool_calls', {
  description: 'MCP tool calls served by this instance',
});

const authFailureCount = meter.createCounter<{
  reason: AgentAccessAuthFailureReason;
}>('agent_access_auth_failures', {
  description: 'agent-access authentication rejections on this instance',
});

export function recordAgentAccessToolCall(params: {
  tool: string;
  outcome: AgentAccessToolCallOutcome;
}): void {
  try {
    toolCallCount.add(1, params);
  } catch {
    // Metrics must not affect MCP responses.
  }
}

export function recordAgentAccessAuthFailure(reason: AgentAccessAuthFailureReason): void {
  try {
    authFailureCount.add(1, {reason});
  } catch {
    // Metrics must not affect HTTP authentication responses.
  }
}
