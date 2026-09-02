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
    const bucket = activeBucket(key, timestamp) ?? {startedAt: timestamp, count: 0};

    const decision = decisionForBucket(bucket, timestamp);
    if (!decision.allowed) return decision;

    bucket.count += 1;
    buckets.set(key, bucket);
    return {allowed: true};
  };

  const check = (credential: AgentAccessCredential): AgentAccessRateLimitDecision => {
    const timestamp = now();
    pruneExpiredBuckets(timestamp);
    const bucket = activeBucket(credentialKey(credential), timestamp);
    return bucket === undefined ? {allowed: true} : decisionForBucket(bucket, timestamp);
  };

  return {
    consume,
    check,
    size: () => buckets.size,
  };

  function activeBucket(key: string, timestamp: number): Bucket | undefined {
    const bucket = buckets.get(key);
    if (bucket !== undefined && timestamp >= bucket.startedAt + windowMs) {
      buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  function decisionForBucket(bucket: Bucket, timestamp: number): AgentAccessRateLimitDecision {
    if (bucket.count < limit) return {allowed: true};
    return {
      allowed: false,
      retry_after_seconds: Math.max(1, Math.ceil((bucket.startedAt + windowMs - timestamp) / 1000)),
    };
  }

  function pruneExpiredBuckets(timestamp: number): void {
    for (const [key, bucket] of buckets) {
      if (timestamp >= bucket.startedAt + windowMs) buckets.delete(key);
    }
  }
}

function credentialKey(credential: AgentAccessCredential): string {
  return `oauth_grant:${credential.grantId}`;
}
