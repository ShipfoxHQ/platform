const metricMocks = vi.hoisted(() => {
  const metrics = new Map<
    string,
    {add: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn>}
  >();
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const histograms = new Map<string, {record: ReturnType<typeof vi.fn>}>();
  const createMetric = vi.fn((name: string) => {
    const metric = {add: vi.fn(), record: vi.fn()};
    metrics.set(name, metric);
    return metric;
  });
  const createCounter = vi.fn((name: string) => {
    const metric = createMetric(name);
    counters.set(name, {add: metric.add});
    return metric;
  });
  const createHistogram = vi.fn((name: string) => {
    const metric = createMetric(name);
    histograms.set(name, {record: metric.record});
    return metric;
  });

  return {
    counters,
    createCounter,
    createHistogram,
    createMetric,
    histograms,
    metrics,
  };
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
  metricMocks.metrics.clear();
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

function metric(name: string): {add: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn>} {
  const result = metricMocks.metrics.get(name);
  if (!result) throw new Error(`Missing metric: ${name}`);
  return result;
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

describe('workflow-run detail measurement metrics', () => {
  test('records bounded labels and read measurements', () => {
    metrics.recordWorkflowRunDetailRead({
      durationMilliseconds: 42,
      databaseDurationMilliseconds: 17,
      responseBytes: 12_345,
      returnedRows: 24,
      requestKind: 'polling',
      outcome: 'success',
    });

    const labels = {request_kind: 'polling', outcome: 'success'};
    expect(metric('workflows_run_detail_reads').add).toHaveBeenCalledWith(1, labels);
    expect(metric('workflows_run_detail_duration').record).toHaveBeenCalledWith(42, labels);
    expect(metric('workflows_run_detail_database_duration').record).toHaveBeenCalledWith(
      17,
      labels,
    );
    expect(metric('workflows_run_detail_response_bytes').record).toHaveBeenCalledWith(
      12_345,
      labels,
    );
    expect(metric('workflows_run_detail_returned_rows').record).toHaveBeenCalledWith(24, labels);
  });

  test('classifies omitted and unsupported request kinds as unknown', () => {
    expect(metrics.classifyWorkflowRunDetailRequestKind(undefined)).toBe('unknown');
    expect(metrics.classifyWorkflowRunDetailRequestKind(['polling'])).toBe('unknown');
    expect(metrics.classifyWorkflowRunDetailRequestKind('unsupported')).toBe('unknown');
    expect(metrics.classifyWorkflowRunDetailRequestKind('initial')).toBe('initial');
  });

  test('does not let metric failures affect callers', () => {
    metric('workflows_run_detail_reads').add.mockImplementationOnce(() => {
      throw new Error('metrics unavailable');
    });

    expect(() =>
      metrics.recordWorkflowRunDetailRead({
        durationMilliseconds: 1,
        databaseDurationMilliseconds: 1,
        responseBytes: 1,
        returnedRows: 1,
        requestKind: 'unknown',
        outcome: 'error',
      }),
    ).not.toThrow();
  });
});
