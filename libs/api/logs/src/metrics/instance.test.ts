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
  logger: () => ({debug: vi.fn()}),
}));

let metrics: typeof import('./instance.js');

beforeAll(async () => {
  // This package intentionally runs with isolate: false. Reset the shared module cache before
  // importing the metrics module so a previous file's real OpenTelemetry module cannot bypass
  // this mock.
  vi.resetModules();
  metricMocks.counters.clear();
  metricMocks.createCounter.mockClear();
  metrics = await import('./instance.js');
});

describe('logs instance metrics', () => {
  it('defines byte-volume counters with OpenTelemetry byte units and no labels', () => {
    const calls = metricMocks.createCounter.mock.calls as unknown as Array<
      [string, {unit?: string; description?: string}]
    >;

    const byteCounterNames = ['logs_bytes_ingested', 'logs_bytes_stored', 'logs_compacted_bytes'];
    const byteCounters = calls
      .filter(([name]) => byteCounterNames.includes(name))
      .map(([name, options]) => ({name, unit: options.unit, description: options.description}));

    expect(byteCounters).toEqual([
      {
        name: 'logs_bytes_ingested',
        unit: 'By',
        description:
          'Raw runner bytes accepted after offset validation (in-order CAS extension; retries, gaps, closed-stream and cap-dropped bodies excluded)',
      },
      {
        name: 'logs_bytes_stored',
        unit: 'By',
        description:
          'Normalized durable bytes written to log chunks from runner appends (server tombstones and cap-dropped bodies excluded)',
      },
      {
        name: 'logs_compacted_bytes',
        unit: 'By',
        description: 'Uncompressed log bytes successfully compacted to object storage',
      },
    ]);
  });

  it('records ingested and stored bytes without labels', () => {
    metrics.bytesIngestedCount.add(1024);
    metrics.bytesStoredCount.add(512);
    metrics.compactedBytesCount.add(256);

    expect(metricMocks.counters.get('logs_bytes_ingested')?.add).toHaveBeenCalledWith(1024);
    expect(metricMocks.counters.get('logs_bytes_stored')?.add).toHaveBeenCalledWith(512);
    expect(metricMocks.counters.get('logs_compacted_bytes')?.add).toHaveBeenCalledWith(256);
  });
});
