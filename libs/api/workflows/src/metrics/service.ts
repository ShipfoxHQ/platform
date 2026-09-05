import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countActiveListeners} from '#db/job-listeners.js';
import {getListenerEventStorageStats} from '#db/listener-storage.js';
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
  const listenerEventRows = meter.createObservableGauge('workflows_listener_event_rows', {
    description: 'Canonical listener-event rows currently retained',
  });
  const listenerEventPayloadBytes = meter.createObservableGauge(
    'workflows_listener_event_payload_bytes',
    {
      description: 'Stored payload bytes in canonical listener-event rows',
      unit: 'By',
    },
  );
  const listenerEventConsumedOldestAge = meter.createObservableGauge(
    'workflows_listener_event_consumed_oldest_age',
    {
      description: 'Age in milliseconds of the oldest consumed canonical listener event',
      unit: 'ms',
    },
  );
  const listenerEventPendingOldestAge = meter.createObservableGauge(
    'workflows_listener_event_pending_oldest_age',
    {
      description: 'Age in milliseconds of the oldest pending canonical listener event',
      unit: 'ms',
    },
  );
  const duplicateTriggerEventsBytes = meter.createObservableGauge(
    'workflows_duplicate_trigger_events_bytes',
    {
      description: 'Bytes retained in legacy job-execution trigger-event arrays',
      unit: 'By',
    },
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      const [depth, listenerCount, toolInvocationDepth, storage] = await Promise.all([
        getWorkflowJobExecutionDepth(),
        countActiveListeners(),
        getToolInvocationDepth(),
        getListenerEventStorageStats(),
      ]);
      observer.observe(runningRuns, depth.runningRuns);
      observer.observe(runningJobExecutions, depth.runningJobExecutions);
      observer.observe(activeListeners, listenerCount);
      observer.observe(queuedToolInvocations, toolInvocationDepth.queued);
      observer.observe(inFlightToolInvocations, toolInvocationDepth.inFlight);
      observer.observe(listenerEventRows, storage.listenerEventRows);
      observer.observe(listenerEventPayloadBytes, storage.listenerEventPayloadBytes);
      observer.observe(
        listenerEventConsumedOldestAge,
        storage.consumedListenerEventOldestAgeMilliseconds,
      );
      observer.observe(
        listenerEventPendingOldestAge,
        storage.pendingListenerEventOldestAgeMilliseconds,
      );
      observer.observe(duplicateTriggerEventsBytes, storage.duplicateTriggerEventsBytes);
    },
    [
      runningRuns,
      runningJobExecutions,
      activeListeners,
      queuedToolInvocations,
      inFlightToolInvocations,
      listenerEventRows,
      listenerEventPayloadBytes,
      listenerEventConsumedOldestAge,
      listenerEventPendingOldestAge,
      duplicateTriggerEventsBytes,
    ],
  );
}
