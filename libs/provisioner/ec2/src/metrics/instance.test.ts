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

let metrics: typeof import('./instance.js');

describe('EC2 provisioner metrics', () => {
  beforeEach(async () => {
    vi.resetModules();
    metricMocks.counters.clear();
    metricMocks.histograms.clear();
    metrics = await import('./instance.js');
  });

  const durationLabels = {
    templateKey: 'spot-small',
    market: 'spot' as const,
    architecture: 'x86_64' as const,
    availabilityZone: 'eu-west-3a',
  };

  it('records launch outcomes with bounded labels', () => {
    metrics.recordEc2Launch('spot', 'capacity', 'spot-small');

    expect(counterAdd('ec2_provisioner_launch')).toHaveBeenCalledWith(1, {
      template_key: 'spot-small',
      market: 'spot',
      outcome: 'capacity',
    });
  });

  it('records termination reasons with bounded labels', () => {
    metrics.recordEc2Termination('spot-interruption', 'spot-small');

    expect(counterAdd('ec2_provisioner_terminate')).toHaveBeenCalledWith(1, {
      template_key: 'spot-small',
      reason: 'spot-interruption',
    });
  });

  it('records forced termination retries by template', () => {
    metrics.recordEc2ForcedTerminationRetry('spot-small');

    expect(counterAdd('ec2_provisioner_terminate_forced_retry')).toHaveBeenCalledWith(1, {
      template_key: 'spot-small',
    });
  });

  it('records exhausted stopping retries by template', () => {
    metrics.recordEc2StoppingRetryExhausted('spot-small');

    expect(counterAdd('ec2_provisioner_stopping_retry_exhausted')).toHaveBeenCalledWith(1, {
      template_key: 'spot-small',
    });
  });

  it('records missing stopping timestamps by template', () => {
    metrics.recordEc2StoppingTimestampMissing('spot-small');

    expect(counterAdd('ec2_provisioner_stopping_timestamp_missing')).toHaveBeenCalledWith(1, {
      template_key: 'spot-small',
    });
  });

  it('records the reconcile absence count without labels', () => {
    metrics.recordEc2ReconcileAbsent(2);

    expect(counterAdd('ec2_provisioner_reconcile_absent')).toHaveBeenCalledWith(2);
  });

  it('records EC2 launch duration with bounded labels', () => {
    metrics.recordEc2LaunchDuration({durationMs: 1_250, ...durationLabels});

    expect(histogramRecord('ec2_provisioner_launch_duration')).toHaveBeenCalledWith(1_250, {
      template_key: 'spot-small',
      market: 'spot',
      architecture: 'x86_64',
      availability_zone: 'eu-west-3a',
    });
  });

  it('records EC2 pending duration with bounded labels', () => {
    metrics.recordEc2PendingDuration({durationMs: 18_000, ...durationLabels});

    expect(histogramRecord('ec2_provisioner_pending_duration')).toHaveBeenCalledWith(18_000, {
      template_key: 'spot-small',
      market: 'spot',
      architecture: 'x86_64',
      availability_zone: 'eu-west-3a',
    });
  });
});
