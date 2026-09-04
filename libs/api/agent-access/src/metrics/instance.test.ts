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
    getMeter: () => ({createCounter: metricMocks.createCounter}),
  },
}));

const metrics = await import('./instance.js');

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

describe('agent-access instance metrics', () => {
  beforeEach(() => {
    counterAdd('agent_access_tool_calls').mockReset();
    counterAdd('agent_access_auth_failures').mockReset();
    counterAdd('agent_access_log_sections_unavailable').mockReset();
  });

  test('declares the bounded tool-call and authentication metrics', () => {
    expect(metricMocks.createCounter).toHaveBeenCalledWith('agent_access_tool_calls', {
      description: 'MCP tool calls served by this instance',
    });
    expect(metricMocks.createCounter).toHaveBeenCalledWith('agent_access_auth_failures', {
      description: 'agent-access authentication rejections on this instance',
    });
    expect(metricMocks.createCounter).toHaveBeenCalledWith(
      'agent_access_log_sections_unavailable',
      {description: 'Agent-access log sections unavailable on this instance'},
    );
  });

  test('records tool calls and authentication rejections with bounded labels', () => {
    metrics.recordAgentAccessToolCall({tool: 'agent_access_fixture', outcome: 'rate-limited'});
    metrics.recordAgentAccessAuthFailure('origin-not-allowed');
    metrics.recordAgentAccessLogSectionUnavailable('compacted-log-unavailable');

    expect(counterAdd('agent_access_tool_calls')).toHaveBeenCalledWith(1, {
      tool: 'agent_access_fixture',
      outcome: 'rate-limited',
    });
    expect(counterAdd('agent_access_auth_failures')).toHaveBeenCalledWith(1, {
      reason: 'origin-not-allowed',
    });
    expect(counterAdd('agent_access_log_sections_unavailable')).toHaveBeenCalledWith(1, {
      reason: 'compacted-log-unavailable',
    });
  });

  test('does not let metric failures affect gateway callers', () => {
    counterAdd('agent_access_tool_calls').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });
    counterAdd('agent_access_auth_failures').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });
    counterAdd('agent_access_log_sections_unavailable').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    expect(() =>
      metrics.recordAgentAccessToolCall({tool: 'agent_access_fixture', outcome: 'success'}),
    ).not.toThrow();
    expect(() => metrics.recordAgentAccessAuthFailure('invalid')).not.toThrow();
    expect(() =>
      metrics.recordAgentAccessLogSectionUnavailable('compacted-log-unavailable'),
    ).not.toThrow();
  });
});
