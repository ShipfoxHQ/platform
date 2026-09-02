import type {AgentAccessCredential} from '@shipfox/api-auth-context';
import {AGENT_ACCESS_TOOL_CALL_LIMIT, AGENT_ACCESS_TOOL_CALL_WINDOW_MS} from '#constants.js';

export interface AgentAccessRateLimitDecision {
  allowed: boolean;
  retry_after_seconds?: number | undefined;
}

export interface AgentAccessRateLimiter {
  consume(credential: AgentAccessCredential): AgentAccessRateLimitDecision;
  check(credential: AgentAccessCredential): AgentAccessRateLimitDecision;
  size(): number;
}

export interface CreateAgentAccessRateLimiterOptions {
  now?: () => number;
  limit?: number;
  windowMs?: number;
}

interface Bucket {
  startedAt: number;
  count: number;
}

/** A flat, process-local fixed window keyed by the authenticated credential. */
export function createAgentAccessRateLimiter(
  options: CreateAgentAccessRateLimiterOptions = {},
): AgentAccessRateLimiter {
  const now = options.now ?? Date.now;
  const limit = options.limit ?? AGENT_ACCESS_TOOL_CALL_LIMIT;
  const windowMs = options.windowMs ?? AGENT_ACCESS_TOOL_CALL_WINDOW_MS;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Agent-access rate limit is invalid');
  if (!Number.isInteger(windowMs) || windowMs < 1) {
    throw new Error('Agent-access rate-limit window is invalid');
  }

  const buckets = new Map<string, Bucket>();

  const consume = (credential: AgentAccessCredential): AgentAccessRateLimitDecision => {
    const timestamp = now();
    pruneExpiredBuckets(timestamp);
    const key = credentialKey(credential);
    const current = buckets.get(key);
    const bucket =
      current === undefined || timestamp >= current.startedAt + windowMs
        ? {startedAt: timestamp, count: 0}
        : current;

    if (bucket.count >= limit) {
      return {
        allowed: false,
        retry_after_seconds: Math.max(
          1,
          Math.ceil((bucket.startedAt + windowMs - timestamp) / 1000),
        ),
      };
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    return {allowed: true};
  };

  return {
    consume,
    check: consume,
    size: () => buckets.size,
  };

  function pruneExpiredBuckets(timestamp: number): void {
    for (const [key, bucket] of buckets) {
      if (timestamp >= bucket.startedAt + windowMs) buckets.delete(key);
    }
  }
}

function credentialKey(credential: AgentAccessCredential): string {
  return credential.kind === 'oauth_grant'
    ? `oauth_grant:${credential.grantId}`
    : `pat:${credential.patId}`;
}
