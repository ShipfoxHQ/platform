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

let metrics: typeof import('./instance.js');

beforeEach(async () => {
  vi.resetModules();
  metricMocks.counters.clear();
  metricMocks.histograms.clear();
  metrics = await import('./instance.js');
});

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

describe('workflow tool invocation metrics', () => {
  test('defines the duration histogram and reclaim counter with bounded labels', () => {
    const histogramCall = (
      metricMocks.createHistogram.mock.calls as unknown as Array<
        [string, {unit?: string; advice?: {explicitBucketBoundaries?: number[]}}]
      >
    ).find(([name]) => name === 'workflows_tool_invocation_duration_ms');
    expect(histogramCall).toEqual([
      'workflows_tool_invocation_duration_ms',
      expect.objectContaining({
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [10, 50, 100, 500, 1_000, 5_000, 30_000, 120_000],
        },
      }),
    ]);

    const counterCall = (
      metricMocks.createCounter.mock.calls as unknown as Array<[string, {description?: string}]>
    ).find(([name]) => name === 'workflows_tool_invocation_reclaims');
    expect(counterCall).toEqual([
      'workflows_tool_invocation_reclaims',
      expect.objectContaining({description: expect.any(String)}),
    ]);
  });

  test('records duration with provider and outcome labels', () => {
    metrics.recordWorkflowToolInvocationDuration('github', 'success', 1_234);
    metrics.recordWorkflowToolInvocationDuration('linear', 'error', 5_678);

    expect(histogramRecord('workflows_tool_invocation_duration_ms')).toHaveBeenNthCalledWith(
      1,
      1_234,
      {provider: 'github', outcome: 'success'},
    );
    expect(histogramRecord('workflows_tool_invocation_duration_ms')).toHaveBeenNthCalledWith(
      2,
      5_678,
      {provider: 'linear', outcome: 'error'},
    );
  });

  test('records reclaims with their action and ignores empty batches', () => {
    metrics.recordWorkflowToolInvocationReclaims('requeued', 2);
    metrics.recordWorkflowToolInvocationReclaims('failed', 1);
    metrics.recordWorkflowToolInvocationReclaims('failed', 0);

    expect(counterAdd('workflows_tool_invocation_reclaims')).toHaveBeenNthCalledWith(1, 2, {
      action: 'requeued',
    });
    expect(counterAdd('workflows_tool_invocation_reclaims')).toHaveBeenNthCalledWith(2, 1, {
      action: 'failed',
    });
    expect(counterAdd('workflows_tool_invocation_reclaims')).toHaveBeenCalledTimes(2);
  });
});
