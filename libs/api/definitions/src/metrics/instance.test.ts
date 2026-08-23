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

describe('definition at-ref metrics', () => {
  beforeEach(() => {
    counterAdd('definitions_ref_resolutions').mockReset();
  });

  test.each([
    'resolved',
    'ref-moved',
    'content-too-large',
    'too-many-files',
    'source-unavailable',
  ] as const)('records the %s outcome', (outcome) => {
    metrics.recordDefinitionRefResolution(outcome);

    expect(counterAdd('definitions_ref_resolutions')).toHaveBeenCalledWith(1, {outcome});
  });

  test('does not let metric failures affect resolution callers', () => {
    counterAdd('definitions_ref_resolutions').mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    expect(() => metrics.recordDefinitionRefResolution('resolved')).not.toThrow();
  });
});
