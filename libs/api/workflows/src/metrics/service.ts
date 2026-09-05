import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {countActiveListeners} from '#db/job-listeners.js';
import {
  getListenerEventStorageStats,
  type ListenerEventStorageStats,
} from '#db/listener-storage.js';
import {getToolInvocationDepth, getWorkflowJobExecutionDepth} from '#db/workflow-runs.js';

const LISTENER_EVENT_STORAGE_STATS_CACHE_TTL_MS = 60_000;

function createListenerEventStorageStatsCache(): () => Promise<ListenerEventStorageStats> {
  let cached: {value: ListenerEventStorageStats; expiresAt: number} | undefined;
  let refresh: Promise<ListenerEventStorageStats> | undefined;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    refresh ??= getListenerEventStorageStats()
      .then((value) => {
        cached = {value, expiresAt: Date.now() + LISTENER_EVENT_STORAGE_STATS_CACHE_TTL_MS};
        return value;
      })
      .finally(() => {
        refresh = undefined;
      });

    try {
      return await refresh;
    } catch (error) {
      if (cached) return cached.value;
      throw error;
    }
  };
}

export function registerWorkflowsServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('workflows');
  const getCachedListenerEventStorageStats = createListenerEventStorageStatsCache();

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
      const [depth, listenerCount, toolInvocationDepth, storage] = await Promise.allSettled([
        getWorkflowJobExecutionDepth(),
        countActiveListeners(),
        getToolInvocationDepth(),
        getCachedListenerEventStorageStats(),
      ]);
      if (depth.status === 'fulfilled') {
        observer.observe(runningRuns, depth.value.runningRuns);
        observer.observe(runningJobExecutions, depth.value.runningJobExecutions);
      }
      if (listenerCount.status === 'fulfilled')
        observer.observe(activeListeners, listenerCount.value);
      if (toolInvocationDepth.status === 'fulfilled') {
        observer.observe(queuedToolInvocations, toolInvocationDepth.value.queued);
        observer.observe(inFlightToolInvocations, toolInvocationDepth.value.inFlight);
      }
      if (storage.status === 'fulfilled') {
        observer.observe(listenerEventRows, storage.value.listenerEventRows);
        observer.observe(listenerEventPayloadBytes, storage.value.listenerEventPayloadBytes);
        observer.observe(
          listenerEventConsumedOldestAge,
          storage.value.consumedListenerEventOldestAgeMilliseconds,
        );
        observer.observe(
          listenerEventPendingOldestAge,
          storage.value.pendingListenerEventOldestAgeMilliseconds,
        );
        observer.observe(duplicateTriggerEventsBytes, storage.value.duplicateTriggerEventsBytes);
      }
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
