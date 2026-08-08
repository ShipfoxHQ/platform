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
  instanceMetrics: {getMeter: () => ({createCounter: metricMocks.createCounter})},
}));

function counterAdd(name: string): ReturnType<typeof vi.fn> {
  const counter = metricMocks.counters.get(name);
  if (!counter) throw new Error(`Missing counter: ${name}`);
  return counter.add;
}

let metrics: typeof import('./instance.js');

describe('EC2 provisioner metrics', () => {
  beforeEach(async () => {
    vi.resetModules();
    metricMocks.counters.clear();
    metrics = await import('./instance.js');
  });

  it('records launch outcomes with bounded labels', () => {
    metrics.recordEc2Launch('spot', 'capacity');

    expect(counterAdd('ec2_provisioner_launch')).toHaveBeenCalledWith(1, {
      market: 'spot',
      outcome: 'capacity',
    });
  });

  it('records termination reasons with bounded labels', () => {
    metrics.recordEc2Termination('spot-interruption');

    expect(counterAdd('ec2_provisioner_terminate')).toHaveBeenCalledWith(1, {
      reason: 'spot-interruption',
    });
  });

  it('records the reconcile absence count without labels', () => {
    metrics.recordEc2ReconcileAbsent(2);

    expect(counterAdd('ec2_provisioner_reconcile_absent')).toHaveBeenCalledWith(2);
  });
});
