import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type AuthTokenType = 'session' | 'job_lease' | 'runner_session';
export type AuthTokenVerificationOutcome = 'ok' | 'rejected';
export type AuthTokenRefreshOutcome = 'rotated' | 'grace' | 'rejected';
export type AuthRateLimitAction =
  | 'login'
  | 'email-send'
  | 'bootstrap'
  | 'bootstrap-state'
  | 'lookup'
  | 'impersonate';
export type AuthRateLimitScope = 'ip' | 'email' | 'actor';
export type AuthRateLimitOutcome = 'allowed' | 'blocked' | 'unavailable';
export type AuthImpersonationOutcome = 'succeeded' | 'failed';

const meter = instanceMetrics.getMeter('auth');

const tokenIssuedCount = meter.createCounter<{token_type: AuthTokenType}>('auth_token_issued', {
  description: 'Tokens issued by token type',
});

const tokenVerifiedCount = meter.createCounter<{
  token_type: AuthTokenType;
  outcome: AuthTokenVerificationOutcome;
}>('auth_token_verified', {description: 'Token verification attempts by token type and outcome'});

const tokenRefreshedCount = meter.createCounter<{outcome: AuthTokenRefreshOutcome}>(
  'auth_token_refreshed',
  {description: 'Refresh-token exchanges by outcome'},
);

const rateLimitCheckCount = meter.createCounter<{
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  outcome: AuthRateLimitOutcome;
}>('auth_rate_limit_checks', {
  description: 'Authentication rate limit checks by action, scope, and outcome',
});

const rateLimitPruneFailureCount = meter.createCounter('auth_rate_limit_prune_failures', {
  description: 'Authentication rate limit prune failures',
});

const impersonationCommandCount = meter.createCounter<{outcome: AuthImpersonationOutcome}>(
  'auth_impersonation_commands',
  {description: 'Impersonation mint command attempts by outcome'},
);

function recordMetric(record: () => void): void {
  try {
    record();
  } catch {
    // Metrics must not affect authentication outcomes.
  }
}

export function recordTokenIssued(tokenType: AuthTokenType): void {
  recordMetric(() => tokenIssuedCount.add(1, {token_type: tokenType}));
}

export function recordTokenVerified(
  tokenType: AuthTokenType,
  outcome: AuthTokenVerificationOutcome,
): void {
  recordMetric(() => tokenVerifiedCount.add(1, {token_type: tokenType, outcome}));
}

export function recordTokenRefreshed(outcome: AuthTokenRefreshOutcome): void {
  recordMetric(() => tokenRefreshedCount.add(1, {outcome}));
}

export function recordAuthRateLimitCheck(params: {
  action: AuthRateLimitAction;
  scope: AuthRateLimitScope;
  outcome: AuthRateLimitOutcome;
}): void {
  recordMetric(() =>
    rateLimitCheckCount.add(1, {
      action: params.action,
      scope: params.scope,
      outcome: params.outcome,
    }),
  );
}

export function recordAuthRateLimitPruneFailure(): void {
  recordMetric(() => rateLimitPruneFailureCount.add(1));
}

export function recordImpersonationOutcome(outcome: AuthImpersonationOutcome): void {
  recordMetric(() => impersonationCommandCount.add(1, {outcome}));
}
