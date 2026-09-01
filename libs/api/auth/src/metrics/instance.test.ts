const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });

  return {counters, createCounter};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: metricMocks.createCounter,
    }),
  },
}));

const metrics = await import('./instance.js');

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

describe('auth metrics', () => {
  beforeEach(() => {
    for (const counter of metricMocks.counters.values()) {
      counter.add.mockReset();
    }
  });

  it('records auth rate-limit checks with low-cardinality labels', () => {
    metrics.recordAuthRateLimitCheck({
      action: 'login',
      scope: 'ip',
      outcome: 'blocked',
    });

    expect(counterAdd('auth_rate_limit_checks')).toHaveBeenCalledWith(1, {
      action: 'login',
      scope: 'ip',
      outcome: 'blocked',
    });
  });

  it('records auth rate-limit prune failures', () => {
    metrics.recordAuthRateLimitPruneFailure();

    expect(counterAdd('auth_rate_limit_prune_failures')).toHaveBeenCalledWith(1);
  });

  it('records token issuance and verification outcomes by token type', () => {
    metrics.recordTokenIssued('agent_access');
    metrics.recordTokenVerified('agent_access', 'rejected');

    expect(counterAdd('auth_token_issued')).toHaveBeenCalledWith(1, {
      token_type: 'agent_access',
    });
    expect(counterAdd('auth_token_verified')).toHaveBeenCalledWith(1, {
      token_type: 'agent_access',
      outcome: 'rejected',
    });
  });

  it('does not let metric failures affect callers', () => {
    counterAdd('auth_rate_limit_checks').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    const act = () =>
      metrics.recordAuthRateLimitCheck({
        action: 'email-send',
        scope: 'email',
        outcome: 'unavailable',
      });

    expect(act).not.toThrow();
  });
});
