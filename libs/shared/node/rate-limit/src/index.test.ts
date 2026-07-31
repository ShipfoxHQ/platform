import {
  type ConsumeRateLimitParams,
  checkRateLimit,
  createRateLimitPersistence,
  hashRateLimitIdentifier,
  RateLimitExceededError,
  RateLimitPolicyError,
  RateLimitUnavailableError,
} from './index.js';

type Action = 'login' | 'email-send';
type Scope = 'ip' | 'email';

const HMAC_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SECRET = 'test-secret';
const DOMAIN = 'shipfox.test.rate-limit.identifier.v1';

describe('hashRateLimitIdentifier', () => {
  it('stores identifiers as deterministic HMAC values', () => {
    const first = hashRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: 'person@example.com',
      secret: SECRET,
      domain: DOMAIN,
    });
    const second = hashRateLimitIdentifier({
      action: 'login',
      scope: 'email',
      identifier: 'person@example.com',
      secret: SECRET,
      domain: DOMAIN,
    });

    expect(first).toBe(second);
    expect(first).toMatch(HMAC_HEX_PATTERN);
    expect(first).not.toContain('person@example.com');
  });

  it('separates actions, scopes, and hash domains', () => {
    const base = {
      action: 'login' as const,
      scope: 'email' as const,
      identifier: 'person@example.com',
      secret: SECRET,
      domain: DOMAIN,
    };

    const loginEmail = hashRateLimitIdentifier(base);
    const loginIp = hashRateLimitIdentifier({...base, scope: 'ip'});
    const emailSend = hashRateLimitIdentifier({...base, action: 'email-send'});
    const otherDomain = hashRateLimitIdentifier({...base, domain: 'other-domain'});

    expect(new Set([loginEmail, loginIp, emailSend, otherDomain]).size).toBe(4);
  });
});

describe('checkRateLimit', () => {
  it('allows attempts under the limit and rejects the first over-limit attempt', async () => {
    const consume = createMemoryConsume();
    const now = new Date('2026-06-23T00:00:10Z');

    await checkRateLimit(baseCheckParams({consume, now, limit: 2}));
    await checkRateLimit(baseCheckParams({consume, now, limit: 2}));
    const result = checkRateLimit(baseCheckParams({consume, now, limit: 2}));

    await expect(result).rejects.toMatchObject({
      name: 'RateLimitExceededError',
      retryAfterSeconds: 50,
    });
  });

  it('resets counters in the next fixed window', async () => {
    const consume = createMemoryConsume();

    await checkRateLimit(
      baseCheckParams({consume, now: new Date('2026-06-23T00:00:10Z'), limit: 1}),
    );
    const result = checkRateLimit(
      baseCheckParams({consume, now: new Date('2026-06-23T00:01:01Z'), limit: 1}),
    );

    await expect(result).resolves.toBeUndefined();
  });

  it('reports allowed, blocked, and unavailable outcomes', async () => {
    const consume = createMemoryConsume();
    const checks: string[] = [];
    const allowed = baseCheckParams({
      consume,
      limit: 1,
      onCheck: ({outcome}) => checks.push(outcome),
    });
    const blocked = baseCheckParams({
      consume,
      limit: 1,
      onCheck: ({outcome}) => checks.push(outcome),
    });
    const unavailable = baseCheckParams({
      consume: () => Promise.reject(new Error('db unavailable')),
      onCheck: ({outcome}) => checks.push(outcome),
    });

    await checkRateLimit(allowed);
    await expect(checkRateLimit(blocked)).rejects.toBeInstanceOf(RateLimitExceededError);
    await expect(checkRateLimit(unavailable)).rejects.toBeInstanceOf(RateLimitUnavailableError);

    expect(checks).toEqual(['allowed', 'blocked', 'unavailable']);
  });

  it.each([
    ['limit', 0],
    ['limit', -1],
    ['limit', Number.NaN],
    ['limit', Number.POSITIVE_INFINITY],
    ['windowSeconds', 0],
    ['windowSeconds', -1],
    ['windowSeconds', Number.NaN],
    ['windowSeconds', Number.POSITIVE_INFINITY],
  ] as const)('rejects invalid %s policy values', async (name, value) => {
    const consume = vi.fn(createMemoryConsume());
    const result = checkRateLimit(baseCheckParams({consume, [name]: value}));

    await expect(result).rejects.toBeInstanceOf(RateLimitPolicyError);
    expect(consume).not.toHaveBeenCalled();
  });

  it('passes computed window values and timeout to the injected consume function', async () => {
    let seen: ConsumeRateLimitParams<Action, Scope> | undefined;
    const consume = (params: ConsumeRateLimitParams<Action, Scope>) => {
      seen = params;
      return Promise.resolve({count: 1, expiresAt: params.expiresAt});
    };

    await checkRateLimit(
      baseCheckParams({
        consume,
        now: new Date('2026-06-23T00:03:10Z'),
        timeoutMs: 750,
      }),
    );

    expect(seen).toMatchObject({
      action: 'login',
      scope: 'email',
      windowStart: new Date('2026-06-23T00:03:00Z'),
      expiresAt: new Date('2026-06-23T00:04:00Z'),
      timeoutMs: 750,
    });
    expect(seen?.identifierHmac).toMatch(HMAC_HEX_PATTERN);
  });

  it('does not wait for opportunistic pruning after an allowed check', async () => {
    let finishPrune: ((value: number) => void) | undefined;
    const prune = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finishPrune = resolve;
        }),
    );

    try {
      const result = await Promise.race([
        checkRateLimit(baseCheckParams({consume: createMemoryConsume(), prune})).then(
          () => 'resolved' as const,
        ),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20)),
      ]);

      expect(result).toBe('resolved');
      expect(prune).toHaveBeenCalledWith({now: expect.any(Date)});
    } finally {
      finishPrune?.(0);
    }
  });

  it('reports prune failures without changing the allowed outcome', async () => {
    const onPruneFailure = vi.fn();

    const result = checkRateLimit(
      baseCheckParams({
        consume: createMemoryConsume(),
        prune: () => Promise.reject(new Error('prune failed')),
        onPruneFailure,
      }),
    );

    await expect(result).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onPruneFailure).toHaveBeenCalledTimes(1);
  });

  it('reports synchronous prune failures without changing the allowed outcome', async () => {
    const onPruneFailure = vi.fn();

    const result = checkRateLimit(
      baseCheckParams({
        consume: createMemoryConsume(),
        prune: () => {
          throw new Error('prune failed');
        },
        onPruneFailure,
      }),
    );

    await expect(result).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onPruneFailure).toHaveBeenCalledTimes(1);
  });
});

describe('createRateLimitPersistence', () => {
  it('shares transaction timeout and missing-row handling', async () => {
    const events: string[] = [];
    const persistence = createRateLimitPersistence<{id: string}>({
      transaction: async (callback) => await callback({id: 'transaction'}),
      setStatementTimeout: (transaction, timeoutMs) => {
        events.push(`${transaction.id}:${timeoutMs}`);
        return Promise.resolve();
      },
      consume: (transaction, params) => {
        events.push(`${transaction.id}:${params.action}`);
        return Promise.resolve({count: 1, expiresAt: params.expiresAt});
      },
      prune: () => Promise.resolve(0),
    });

    await expect(
      persistence.consume({
        action: 'login',
        scope: 'email',
        identifierHmac: 'hmac',
        windowStart: new Date('2026-06-23T00:00:00Z'),
        expiresAt: new Date('2026-06-23T00:01:00Z'),
        timeoutMs: 750,
      }),
    ).resolves.toMatchObject({count: 1});
    expect(events).toEqual(['transaction:750', 'transaction:login']);
  });

  it('throttles opportunistic pruning through the shared persistence', async () => {
    const prune = vi.fn(async () => 1);
    const persistence = createRateLimitPersistence<object>({
      transaction: async (callback) => await callback({}),
      setStatementTimeout: () => Promise.resolve(),
      consume: (_transaction, params) => Promise.resolve({count: 1, expiresAt: params.expiresAt}),
      prune,
    });
    const firstNow = new Date('2026-06-23T00:00:00Z');
    const secondNow = new Date('2026-06-23T00:00:30Z');

    await expect(persistence.prune({now: firstNow, minIntervalMs: 60_000})).resolves.toBe(1);
    await expect(
      persistence.prune({now: secondNow, minIntervalMs: 60_000}),
    ).resolves.toBeUndefined();
    expect(prune).toHaveBeenCalledTimes(1);
  });
});

function baseCheckParams(
  overrides: Partial<Parameters<typeof checkRateLimit<Action, Scope>>[0]> = {},
): Parameters<typeof checkRateLimit<Action, Scope>>[0] {
  return {
    action: 'login',
    scope: 'email',
    identifier: 'person@example.com',
    identifierSecret: SECRET,
    identifierHashDomain: DOMAIN,
    limit: 2,
    windowSeconds: 60,
    consume: createMemoryConsume(),
    ...overrides,
  };
}

function createMemoryConsume() {
  const counts = new Map<string, number>();
  return (params: ConsumeRateLimitParams<Action, Scope>) => {
    const key = [
      params.action,
      params.scope,
      params.identifierHmac,
      params.windowStart.toISOString(),
    ].join(':');
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return Promise.resolve({count, expiresAt: params.expiresAt});
  };
}
