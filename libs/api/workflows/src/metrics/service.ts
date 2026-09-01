import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countActiveListeners} from '#db/job-listeners.js';
import {getToolInvocationDepth, getWorkflowJobExecutionDepth} from '#db/workflow-runs.js';

export function registerWorkflowsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workflows');

  const runningRuns = meter.createObservableGauge('workflows_running_runs', {
    description: 'Workflow runs currently marked running',
  });
  const runningJobExecutions = meter.createObservableGauge('workflows_running_job_executions', {
    description: 'Workflow job executions currently marked running',
  });
  const activeListeners = meter.createObservableGauge('workflows_active_listeners', {
    description: 'Workflow jobs currently marked as listening',
  });
  const queuedToolInvocations = meter.createObservableGauge('workflows_tool_invocations_queued', {
    description: 'Server-executed workflow tool invocations currently queued',
  });
  const inFlightToolInvocations = meter.createObservableGauge(
    'workflows_tool_invocations_in_flight',
    {
      description: 'Server-executed workflow tool invocations currently in flight',
    },
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      const [depth, listenerCount, toolInvocationDepth] = await Promise.all([
        getWorkflowJobExecutionDepth(),
        countActiveListeners(),
        getToolInvocationDepth(),
      ]);
      observer.observe(runningRuns, depth.runningRuns);
      observer.observe(runningJobExecutions, depth.runningJobExecutions);
      observer.observe(activeListeners, listenerCount);
      observer.observe(queuedToolInvocations, toolInvocationDepth.queued);
      observer.observe(inFlightToolInvocations, toolInvocationDepth.inFlight);
    },
    [
      runningRuns,
      runningJobExecutions,
      activeListeners,
      queuedToolInvocations,
      inFlightToolInvocations,
    ],
  );
}
