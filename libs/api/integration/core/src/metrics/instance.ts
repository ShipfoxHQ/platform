import type {IntegrationProviderErrorReason} from '@shipfox/api-integration-spi';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('integrations');

export type IntegrationAgentToolCallOutcome =
  | 'success'
  | 'tool-error'
  | 'invalid-request'
  | 'exception';

export type IntegrationToolCallCallerLabel = 'agent' | 'tool_step';

export type IntegrationToolRepositoryAccessMode = 'selected' | 'all';
export type IntegrationToolRepositoryClassification =
  | 'declared-targets'
  | 'connection'
  | 'unclassified';
export type IntegrationToolRepositoryDecision =
  | 'allowed'
  | 'denied'
  | 'not-applicable'
  | 'not-enforced';
export type IntegrationToolRepositoryDenialReason =
  | 'none'
  | 'repository_not_granted'
  | 'repository_ambiguous'
  | 'authorization_store_unavailable';

export type IntegrationAgentToolCallErrorCode =
  | 'invalid-request'
  | 'search-qualifier-conflict'
  | 'unknown'
  | 'provider-timeout'
  | 'cancelled'
  | 'credentials-unavailable'
  | 'repository-not-granted'
  | 'repository-ambiguous'
  | 'repository-authorization-unavailable'
  | IntegrationProviderErrorReason;

export type IntegrationAgentToolCallErrorLabel = IntegrationAgentToolCallErrorCode | 'none';

const integrationAgentToolCallErrorCodes = new Set<string>([
  'invalid-request',
  'search-qualifier-conflict',
  'unknown',
  'provider-timeout',
  'cancelled',
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
  'repository-not-granted',
  'repository-ambiguous',
  'repository-authorization-unavailable',
]);

const agentToolCallCount = meter.createCounter<{
  caller: IntegrationToolCallCallerLabel;
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
  error_code: IntegrationAgentToolCallErrorLabel;
}>('integrations_agent_tool_call', {
  description:
    'Integration agent tool calls by caller, provider, tool, method, outcome, and bounded error code',
});

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect integration tool call outcomes.
  }
}

export function recordIntegrationAgentToolCall(params: {
  caller: IntegrationToolCallCallerLabel;
  provider: string;
  tool: string;
  method: string;
  outcome: IntegrationAgentToolCallOutcome;
  error_code: IntegrationAgentToolCallErrorLabel;
}): void {
  recordMetric(() => agentToolCallCount.add(1, params));
}

const agentToolRepositoryAuthorizationCount = meter.createCounter<{
  provider: string;
  mode: IntegrationToolRepositoryAccessMode;
  classification: IntegrationToolRepositoryClassification;
  decision: IntegrationToolRepositoryDecision;
  denial_reason: IntegrationToolRepositoryDenialReason;
}>('integrations_agent_tool_repository_authorization', {
  description:
    'Integration agent tool repository authorization decisions by provider, mode, classification, decision, and bounded denial reason',
});

export function recordIntegrationAgentToolRepositoryAuthorization(params: {
  provider: string;
  mode: IntegrationToolRepositoryAccessMode;
  classification: IntegrationToolRepositoryClassification;
  decision: IntegrationToolRepositoryDecision;
  denial_reason: IntegrationToolRepositoryDenialReason;
}): void {
  recordMetric(() => agentToolRepositoryAuthorizationCount.add(1, params));
}

export function normalizeIntegrationAgentToolCallErrorCode(
  value: unknown,
): IntegrationAgentToolCallErrorCode {
  return typeof value === 'string' && integrationAgentToolCallErrorCodes.has(value)
    ? (value as IntegrationAgentToolCallErrorCode)
    : 'unknown';
}
