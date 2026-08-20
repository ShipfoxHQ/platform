const mocks = vi.hoisted(() => {
  const gauges = {
    openChunkBytes: {},
    openStreams: {},
  };
  const gaugeByName = {
    logs_open_chunk_bytes: gauges.openChunkBytes,
    logs_open_streams: gauges.openStreams,
  };
  return {
    addBatchObservableCallback: vi.fn(),
    createObservableGauge: vi.fn((name: string) => gaugeByName[name as keyof typeof gaugeByName]),
    gauges,
    getMeter: vi.fn(),
    getOpenStreamCount: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
    getUncompactedChunkBytes: vi.fn(),
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));
vi.mock('#db/chunks.js', () => ({
  getUncompactedChunkBytes: mocks.getUncompactedChunkBytes,
}));
vi.mock('#db/streams.js', () => ({
  getOpenStreamCount: mocks.getOpenStreamCount,
}));

let registerLogsServiceMetrics: typeof import('./service.js').registerLogsServiceMetrics;

beforeAll(async () => {
  // This package intentionally runs with isolate: false. Reset the shared module cache before
  // importing the service so a previous file's real OpenTelemetry module cannot bypass this mock.
  vi.resetModules();
  ({registerLogsServiceMetrics} = await import('./service.js'));
});

describe('registerLogsServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getMeter.mockReset();
    mocks.getOpenStreamCount.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getUncompactedChunkBytes.mockReset();
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
    mocks.getOpenStreamCount.mockResolvedValue(0n);
    mocks.getUncompactedChunkBytes.mockResolvedValue(0n);
  });

  it('observes the un-compacted hot chunk bytes gauge on the service plane with byte units', async () => {
    mocks.getUncompactedChunkBytes.mockResolvedValue(65_536n);

    registerLogsServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('logs_open_chunk_bytes', {
      description:
        'Bytes in un-compacted hot log chunks (open streams plus closed streams awaiting compaction)',
      unit: 'By',
    });
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.openChunkBytes, 65_536);
  });

  it('observes open stream and chunk byte gauges from the same callback', async () => {
    mocks.getOpenStreamCount.mockResolvedValue(3n);
    mocks.getUncompactedChunkBytes.mockResolvedValue(4_096n);

    registerLogsServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.openStreams, 3);
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.openChunkBytes, 4_096);
    expect(mocks.createObservableGauge).toHaveBeenCalledWith('logs_open_streams', {
      description: 'Log streams currently open for appends',
    });
  });
});
