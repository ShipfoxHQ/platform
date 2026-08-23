import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('integrations');

export type IntegrationAgentToolCallOutcome =
  | 'success'
  | 'tool-error'
  | 'invalid-request'
  | 'exception';

export type IntegrationAgentToolCallErrorCode =
  | 'invalid-request'
  | 'unknown'
  | 'provider-timeout'
  | 'credentials-unavailable'
  | IntegrationProviderErrorReason;

export type IntegrationAgentToolCallErrorLabel = IntegrationAgentToolCallErrorCode | 'none';

const integrationAgentToolCallErrorCodes = new Set<string>([
  'invalid-request',
  'unknown',
  'provider-timeout',
  'credentials-unavailable',
  'repository-not-found',
  'installation-not-found',
  'file-not-found',
  'ref-not-found',
  'ref-invalid',
  'access-denied',
  'rate-limited',
  'timeout',
  'provider-unavailable',
  'provider-rejected',
  'malformed-provider-response',
  'content-too-large',
  'too-many-files',
]);

const agentToolCallCount = meter.createCounter<{
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
  error_code: IntegrationAgentToolCallErrorLabel;
}>('integrations_agent_tool_call', {
  description:
    'Integration agent tool calls by provider, tool, method, outcome, and bounded error code',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect integration tool call outcomes.
  }
}

export function recordIntegrationAgentToolCall(params: {
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
  error_code: IntegrationAgentToolCallErrorLabel;
}): void {
  recordMetric(() => agentToolCallCount.add(1, params));
}

export function normalizeIntegrationAgentToolCallErrorCode(
  value: unknown,
): IntegrationAgentToolCallErrorCode {
  return typeof value === 'string' && integrationAgentToolCallErrorCodes.has(value)
    ? (value as IntegrationAgentToolCallErrorCode)
    : 'unknown';
}
