const mocks = vi.hoisted(() => {
  const gauges = {
    enrolledRunnersWithoutRecentReport: {},
    pendingJobExecutions: {},
    providerRunnersByPhase: {},
    providerRunnersByPhaseOldestAge: {},
    providerRunnersByState: {},
    providerRunnersByStateOldestAge: {},
    reservationLeakUnits: {},
    runningJobExecutions: {},
  };
  const gaugeByName = {
    runners_enrolled_without_recent_report: gauges.enrolledRunnersWithoutRecentReport,
    runners_pending_job_executions: gauges.pendingJobExecutions,
    runners_provider_runner_by_phase: gauges.providerRunnersByPhase,
    runners_provider_runner_by_phase_oldest_age: gauges.providerRunnersByPhaseOldestAge,
    runners_provider_runner_by_state: gauges.providerRunnersByState,
    runners_provider_runner_by_state_oldest_age: gauges.providerRunnersByStateOldestAge,
    runners_reservation_leaked_units: gauges.reservationLeakUnits,
    runners_running_job_executions: gauges.runningJobExecutions,
  };
  return {
    addBatchObservableCallback: vi.fn(),
    countStaleEnrolledRunnerInstances: vi.fn(),
    createObservableGauge: vi.fn((name: string) => gaugeByName[name as keyof typeof gaugeByName]),
    gauges,
    getMeter: vi.fn(),
    getJobExecutionQueueDepth: vi.fn(),
    countLiveReservationLeakUnits: vi.fn(),
    listProviderRunnerByPhaseMetrics: vi.fn(),
    listProviderRunnerByStateMetrics: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
  };
});

vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));
vi.mock('#config.js', () => ({
  config: {RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS: 300},
}));
vi.mock('#db/job-executions.js', () => ({
  getJobExecutionQueueDepth: mocks.getJobExecutionQueueDepth,
}));
vi.mock('#db/reservations.js', () => ({
  countLiveReservationLeakUnits: mocks.countLiveReservationLeakUnits,
}));
vi.mock('#db/runner-instances.js', () => ({
  countStaleEnrolledRunnerInstances: mocks.countStaleEnrolledRunnerInstances,
  listProviderRunnerByPhaseMetrics: mocks.listProviderRunnerByPhaseMetrics,
  listProviderRunnerByStateMetrics: mocks.listProviderRunnerByStateMetrics,
}));

let registerRunnersServiceMetrics: typeof import('./service.js').registerRunnersServiceMetrics;

beforeAll(async () => {
  // This package intentionally runs with isolate: false. Reset the shared module cache before
  // importing the service so a previous file's real OpenTelemetry module cannot bypass this mock.
  vi.resetModules();
  ({registerRunnersServiceMetrics} = await import('./service.js'));
});

describe('registerRunnersServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.countStaleEnrolledRunnerInstances.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.getJobExecutionQueueDepth.mockReset();
    mocks.countLiveReservationLeakUnits.mockReset();
    mocks.listProviderRunnerByPhaseMetrics.mockReset();
    mocks.listProviderRunnerByStateMetrics.mockReset();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getJobExecutionQueueDepth.mockResolvedValue({
      pendingJobExecutions: 0,
      runningJobExecutions: 0,
    });
    mocks.countLiveReservationLeakUnits.mockResolvedValue(0);
    mocks.listProviderRunnerByPhaseMetrics.mockResolvedValue([]);
    mocks.listProviderRunnerByStateMetrics.mockResolvedValue([]);
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  it('observes enrolled runners without recent reports after the grace window', async () => {
    mocks.countStaleEnrolledRunnerInstances.mockResolvedValue(2);

    registerRunnersServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith(
      'runners_enrolled_without_recent_report',
      {
        description:
          'Running enrolled runners with a live control session, no workspace or runner session, and no recent provisioner report after the stale-runner grace window',
      },
    );
    expect(mocks.countStaleEnrolledRunnerInstances).toHaveBeenCalledWith({graceSeconds: 300});
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.enrolledRunnersWithoutRecentReport,
      2,
    );
  });

  it('observes live reservation units without an unclaimed runner', async () => {
    mocks.countLiveReservationLeakUnits.mockResolvedValue(3);

    registerRunnersServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('runners_reservation_leaked_units', {
      description: 'Live reservation units without an unclaimed runner behind them',
    });
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.reservationLeakUnits, 3);
  });

  it('keeps queue gauges observable when the enrolled-runner query fails', async () => {
    mocks.getJobExecutionQueueDepth.mockResolvedValue({
      pendingJobExecutions: 3,
      runningJobExecutions: 4,
    });
    mocks.countStaleEnrolledRunnerInstances.mockRejectedValue(new Error('database unavailable'));

    registerRunnersServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.pendingJobExecutions, 3);
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.runningJobExecutions, 4);
    expect(observer.observe).toHaveBeenCalledTimes(3);
  });

  it('observes provider runners by lifecycle state and oldest age', async () => {
    mocks.listProviderRunnerByStateMetrics.mockResolvedValue([
      {state: 'running', count: 3, oldestAgeMilliseconds: 172_800_001},
    ]);

    registerRunnersServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(mocks.createObservableGauge).toHaveBeenCalledWith('runners_provider_runner_by_state', {
      description: 'Active provider runners by bounded lifecycle state',
    });
    expect(mocks.createObservableGauge).toHaveBeenCalledWith(
      'runners_provider_runner_by_state_oldest_age',
      {description: 'Oldest active provider runner age by bounded lifecycle state', unit: 'ms'},
    );
    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.providerRunnersByState, 3, {
      state: 'running',
    });
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.providerRunnersByStateOldestAge,
      172_800_001,
      {state: 'running'},
    );
  });

  it('observes provider runners by lifecycle phase', async () => {
    mocks.listProviderRunnerByPhaseMetrics.mockResolvedValue([
      {
        phase: 'assignment',
        provider: 'ec2',
        launchKind: 'demand',
        count: 3,
        oldestAgeMilliseconds: 42,
      },
    ]);

    registerRunnersServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    if (typeof callback !== 'function') throw new Error('Expected metrics callback');
    const observer = {observe: vi.fn()};

    await callback(observer);

    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.providerRunnersByPhase, 3, {
      phase: 'assignment',
      provider: 'ec2',
      launch_kind: 'demand',
    });
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.providerRunnersByPhaseOldestAge,
      42,
      {phase: 'assignment', provider: 'ec2', launch_kind: 'demand'},
    );
  });
});
