const metricMocks = vi.hoisted(() => {
  const histograms = new Map<string, {record: ReturnType<typeof vi.fn>}>();
  const counters = new Map<string, {add: ReturnType<typeof vi.fn>}>();
  const createHistogram = vi.fn((name: string) => {
    const histogram = {record: vi.fn()};
    histograms.set(name, histogram);
    return histogram;
  });
  const createCounter = vi.fn((name: string) => {
    const counter = {add: vi.fn()};
    counters.set(name, counter);
    return counter;
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
  logger: () => ({debug: vi.fn()}),
}));

let metrics: typeof import('./instance.js');

beforeAll(async () => {
  vi.resetModules();
  metricMocks.counters.clear();
  metricMocks.createCounter.mockClear();
  metricMocks.createHistogram.mockClear();
  metricMocks.histograms.clear();
  metrics = await import('./instance.js');
});

describe('runner lifecycle metrics', () => {
  it('defines termination telemetry with bounded labels', () => {
    const calls = metricMocks.createCounter.mock.calls as unknown as Array<
      [string, {description?: string}]
    >;

    expect(calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'runners_termination_authorization_issued',
        'runners_provider_runner_terminate_intent_honored',
        'runners_termination_authorization_rejected',
        'runners_termination_decision_deferred',
      ]),
    );
  });

  it('records termination authorization outcomes without identifier labels', () => {
    metrics.recordRunnerTerminationAuthorizationIssued('terminal-state');
    metrics.recordRunnerTerminationAuthorizationRejected('unknown-runner');
    metrics.recordRunnerTerminationAuthorizationRejected('unknown-reason');

    expect(
      metricMocks.counters.get('runners_termination_authorization_issued')?.add,
    ).toHaveBeenCalledWith(1, {reason: 'terminal-state'});
    expect(
      metricMocks.counters.get('runners_termination_authorization_rejected')?.add,
    ).toHaveBeenCalledWith(1, {reason: 'unknown-runner'});
    expect(
      metricMocks.counters.get('runners_termination_authorization_rejected')?.add,
    ).toHaveBeenCalledWith(1, {reason: 'unknown-reason'});
  });

  it('records correlated lifecycle deferral with a bounded cause', () => {
    metrics.recordDeferredJobLeaseExpiry();

    expect(
      metricMocks.counters.get('runners_termination_decision_deferred')?.add,
    ).toHaveBeenCalledWith(1, {cause: 'correlated-stale'});
  });

  it('defines provider-runner histograms with millisecond units and buckets', () => {
    const calls = metricMocks.createHistogram.mock.calls as unknown as Array<
      [string, {unit?: string; advice?: {explicitBucketBoundaries?: number[]}}]
    >;

    expect(
      calls
        .filter(([name]) => name.startsWith('runners_provider_runner_'))
        .map(([name, options]) => ({
          name,
          unit: options.unit,
          buckets: options.advice?.explicitBucketBoundaries,
        })),
    ).toEqual([
      {
        name: 'runners_provider_runner_created_to_control_session',
        unit: 'ms',
        buckets: [
          100, 500, 1_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000,
          300_000, 600_000,
        ],
      },
      {
        name: 'runners_provider_runner_control_session_to_assignment',
        unit: 'ms',
        buckets: [
          100, 500, 1_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000,
          300_000, 600_000,
        ],
      },
      {
        name: 'runners_provider_runner_assignment_to_activation',
        unit: 'ms',
        buckets: [10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000],
      },
      {
        name: 'runners_provider_runner_activation_to_first_claim',
        unit: 'ms',
        buckets: [10, 25, 50, 100, 250, 500, 1_000, 5_000, 10_000],
      },
    ]);
  });

  it('records lifecycle durations without converting milliseconds', () => {
    metrics.recordProviderRunnerCreatedToControlSession({
      durationMilliseconds: 1_234,
      provider: 'ec2',
      launchKind: 'demand',
    });

    expect(
      metricMocks.histograms.get('runners_provider_runner_created_to_control_session')?.record,
    ).toHaveBeenCalledWith(1_234, {provider: 'ec2', launch_kind: 'demand'});
  });
});

describe('job execution queue time metrics', () => {
  it('records milliseconds with bounded labels and ignores negative durations', () => {
    const record = metricMocks.histograms.get('runners_job_execution_queue_time')?.record;
    expect(record).toBeDefined();

    metrics.recordJobExecutionQueueTime({
      durationMilliseconds: 1_234,
      provider: null,
      launchKind: 'manual',
    });
    metrics.recordJobExecutionQueueTime({
      durationMilliseconds: -1,
      provider: 'ec2',
      launchKind: 'demand',
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(1_234, {
      provider: 'unknown',
      launch_kind: 'manual',
    });
  });
});
