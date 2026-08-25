import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('agent');

export const modelProviderValidationCount = meter.createCounter<{
  model_provider: SupportedModelProviderId | 'custom';
  outcome: 'succeeded' | 'failed';
}>('model_provider_validation_attempted', {
  description: 'Model provider credential test attempts by model provider and outcome',
});

export const agentRuntimeConfigResolvedCount = meter.createCounter<{
  source: 'workspace' | 'instance';
  outcome: 'resolved' | 'unavailable' | 'decryption_failed';
}>('agent_runtime_config_resolved', {
  description: 'Lease-scoped agent runtime credential resolution by source and outcome',
});

export const sessionClaimReleaseCount = meter.createCounter<{
  path: 'step-attempt' | 'job-grace' | 'reap';
}>('agent_session_claim_released', {
  description: 'Agent session claims released by release path',
});

export const sessionClaimReapFailedCount = meter.createCounter('agent_session_claim_reap_failed', {
  description:
    'Stale agent session claim reaps that threw and were skipped; retried on the next cron run',
});
