import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('runner-workspace');

type CredentialSocketOperation = 'get' | 'store' | 'erase' | 'unknown';
type CredentialSocketOutcome = 'success' | 'rejected' | 'error';

const socketRequestCount = meter.createCounter<{
  operation: CredentialSocketOperation;
  outcome: CredentialSocketOutcome;
}>('runner_credential_socket_requests', {
  description: 'Credential socket requests by operation and bounded outcome',
});

const credentialRenewalCount = meter.createCounter<{outcome: 'success' | 'failure'}>(
  'runner_credential_renewals',
  {description: 'Credential broker renewal outcomes'},
);

export function recordCredentialSocketRequest(
  operation: CredentialSocketOperation,
  outcome: CredentialSocketOutcome,
): void {
  try {
    socketRequestCount.add(1, {operation, outcome});
  } catch {
    // Metrics must not affect credential operations.
  }
}

export function recordCredentialRenewal(outcome: 'success' | 'failure'): void {
  try {
    credentialRenewalCount.add(1, {outcome});
  } catch {
    // Metrics must not affect credential operations.
  }
}
