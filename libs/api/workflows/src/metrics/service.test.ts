const mocks = vi.hoisted(() => {
  const gauges = new Map<string, object>();
  return {
    addBatchObservableCallback: vi.fn(),
    countActiveListeners: vi.fn(),
    getToolInvocationDepth: vi.fn(),
    getWorkflowJobExecutionDepth: vi.fn(),
    createObservableGauge: vi.fn((name: string) => {
      const gauge = {};
      gauges.set(name, gauge);
      return gauge;
    }),
    gauges,
    getMeter: vi.fn(),
    getServiceMetricsProvider: vi.fn(),
  };
});

vi.mock('#db/job-listeners.js', () => ({countActiveListeners: mocks.countActiveListeners}));
vi.mock('#db/workflow-runs.js', () => ({
  getToolInvocationDepth: mocks.getToolInvocationDepth,
  getWorkflowJobExecutionDepth: mocks.getWorkflowJobExecutionDepth,
}));
vi.mock('@shipfox/node-opentelemetry', () => ({
  getServiceMetricsProvider: mocks.getServiceMetricsProvider,
}));

import {registerWorkflowsServiceMetrics} from './service.js';

describe('registerWorkflowsServiceMetrics', () => {
  beforeEach(() => {
    mocks.addBatchObservableCallback.mockReset();
    mocks.countActiveListeners.mockReset();
    mocks.getToolInvocationDepth.mockReset();
    mocks.getWorkflowJobExecutionDepth.mockReset();
    mocks.createObservableGauge.mockClear();
    mocks.gauges.clear();
    mocks.getMeter.mockReset();
    mocks.getServiceMetricsProvider.mockReset();
    mocks.getMeter.mockReturnValue({
      createObservableGauge: mocks.createObservableGauge,
      addBatchObservableCallback: mocks.addBatchObservableCallback,
    });
    mocks.getServiceMetricsProvider.mockReturnValue({getMeter: mocks.getMeter});
  });

  test('observes workflow and tool invocation depth', async () => {
    mocks.getWorkflowJobExecutionDepth.mockResolvedValue({runningRuns: 2, runningJobExecutions: 3});
    mocks.countActiveListeners.mockResolvedValue(4);
    mocks.getToolInvocationDepth.mockResolvedValue({queued: 5, inFlight: 6});

    registerWorkflowsServiceMetrics();
    const callback = mocks.addBatchObservableCallback.mock.calls[0]?.[0];
    const observer = {observe: vi.fn()};

    await callback?.(observer);

    expect(observer.observe).toHaveBeenCalledWith(mocks.gauges.get('workflows_running_runs'), 2);
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.get('workflows_running_job_executions'),
      3,
    );
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.get('workflows_active_listeners'),
      4,
    );
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.get('workflows_tool_invocations_queued'),
      5,
    );
    expect(observer.observe).toHaveBeenCalledWith(
      mocks.gauges.get('workflows_tool_invocations_in_flight'),
      6,
    );
  });
});
