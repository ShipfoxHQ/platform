const metricMocks = vi.hoisted(() => {
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const histograms = new Map<string, {record: ReturnType<typeof vi.fn>}>();
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
  });
  const createHistogram = vi.fn((name: string) => {
    const histogram = {record: vi.fn()};
    histograms.set(name, histogram);
    return histogram;
  });

  return {counters, createCounter, createHistogram, histograms};
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  instanceMetrics: {
    getMeter: () => ({
      createCounter: metricMocks.createCounter,
      createHistogram: metricMocks.createHistogram,
    }),
  },
}));

const metrics = await import('./instance.js');

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

function histogramRecord(name: string): ReturnType<typeof vi.fn> {
  const histogram = metricMocks.histograms.get(name);
  if (!histogram) throw new Error(`Missing histogram: ${name}`);
  return histogram.record;
}

describe('Pi SVG normalization metrics', () => {
  beforeEach(() => {
    for (const counter of metricMocks.counters.values()) counter.add.mockReset();
    for (const histogram of metricMocks.histograms.values()) histogram.record.mockReset();
  });

  it('records converted outcomes with bounded labels', () => {
    metrics.recordPiSvgNormalization('converted', 'none', 'tool_result');

    expect(counterAdd('runner_agent_pi_svg_normalization')).toHaveBeenCalledWith(1, {
      outcome: 'converted',
      reason: 'none',
      source: 'tool_result',
    });
  });

  it('records omitted outcomes with bounded labels', () => {
    metrics.recordPiSvgNormalization('omitted', 'invalid_base64', 'tool_result');

    expect(counterAdd('runner_agent_pi_svg_normalization')).toHaveBeenCalledWith(1, {
      outcome: 'omitted',
      reason: 'invalid_base64',
      source: 'tool_result',
    });
  });

  it('records bounded rasterization duration labels', () => {
    metrics.recordPiSvgRasterizationDuration('omitted', 5_000);

    expect(histogramRecord('runner_agent_pi_svg_rasterization_duration')).toHaveBeenCalledWith(
      5_000,
      {outcome: 'omitted'},
    );
  });
});
