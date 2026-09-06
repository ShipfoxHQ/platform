import type {AgentAccessCredential} from '@shipfox/api-auth-context';
import {AGENT_ACCESS_TOOL_CALL_LIMIT, AGENT_ACCESS_TOOL_CALL_WINDOW_MS} from '#constants.js';
import {createAgentAccessRateLimiter} from './rate-limiter.js';

const oauthCredential: AgentAccessCredential = {
  kind: 'oauth_grant',
  grantId: 'grant-1',
  clientId: 'client-1',
};

describe('agent-access rate limiter', () => {
  test('allows 60 calls per credential and returns retry metadata for the next call', () => {
    let now = 1_000;
    const limiter = createAgentAccessRateLimiter({now: () => now});
    expect(AGENT_ACCESS_TOOL_CALL_LIMIT).toBe(60);

    for (let call = 0; call < AGENT_ACCESS_TOOL_CALL_LIMIT; call += 1) {
      expect(limiter.consume(oauthCredential)).toEqual({allowed: true});
    }

    expect(limiter.consume(oauthCredential)).toEqual({
      allowed: false,
      retry_after_seconds: 60,
    });

    now += AGENT_ACCESS_TOOL_CALL_WINDOW_MS;
    expect(limiter.consume(oauthCredential)).toEqual({allowed: true});
  });

  test('prunes expired OAuth grant buckets', () => {
    let now = 5_000;
    const limiter = createAgentAccessRateLimiter({now: () => now, limit: 1});

    expect(limiter.check(oauthCredential)).toEqual({allowed: true});
    expect(limiter.size()).toBe(0);
    expect(limiter.consume(oauthCredential)).toEqual({allowed: true});
    expect(limiter.size()).toBe(1);

    now += AGENT_ACCESS_TOOL_CALL_WINDOW_MS;
    expect(limiter.consume(oauthCredential)).toEqual({allowed: true});
    expect(limiter.size()).toBe(1);
  });

  test('does not consume a call when checking a bucket', () => {
    let now = 5_000;
    const limiter = createAgentAccessRateLimiter({now: () => now, limit: 1});

    expect(limiter.check(oauthCredential)).toEqual({allowed: true});
    expect(limiter.consume(oauthCredential)).toEqual({allowed: true});
    expect(limiter.check(oauthCredential)).toEqual({
      allowed: false,
      retry_after_seconds: 60,
    });
    expect(limiter.check(oauthCredential)).toEqual({
      allowed: false,
      retry_after_seconds: 60,
    });

    now += AGENT_ACCESS_TOOL_CALL_WINDOW_MS;
    expect(limiter.check(oauthCredential)).toEqual({allowed: true});
  });
});
