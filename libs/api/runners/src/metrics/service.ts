import {getServiceMetricsProvider, type ObservableGauge} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {getJobExecutionQueueDepth} from '#db/job-executions.js';
import {countLiveReservationLeakUnits} from '#db/reservations.js';
import {
  countStaleEnrolledRunnerInstances,
  listProviderRunnerByPhaseMetrics,
  listProviderRunnerByStateMetrics,
  type ProviderRunnerPhaseMetric,
  type ProviderRunnerStateMetric,
} from '#db/runner-instances.js';

type ProviderRunnerPhaseLabels = {
  phase: ProviderRunnerPhaseMetric['phase'];
  provider: string;
  launch_kind: ProviderRunnerPhaseMetric['launchKind'];
};

type ProviderRunnerStateLabels = {
  state: ProviderRunnerStateMetric['state'];
};

export function registerRunnersServiceMetrics(): void {
  const meter = getServiceMetricsProvider().getMeter('runners');

  const pendingJobExecutions = meter.createObservableGauge('runners_pending_job_executions', {
    description: 'Job executions currently waiting in the queue to be claimed',
  });
  const runningJobExecutions = meter.createObservableGauge('runners_running_job_executions', {
    description: 'Job executions currently claimed by a runner and in progress',
  });
  const enrolledRunnersWithoutRecentReport = meter.createObservableGauge(
    'runners_enrolled_without_recent_report',
    {
      description:
        'Running enrolled runners with a live control session, no workspace or runner session, and no recent provisioner report after the stale-runner grace window',
    },
  );
  const providerRunnersByPhase = meter.createObservableGauge<ProviderRunnerPhaseLabels>(
    'runners_provider_runner_by_phase',
    {
      description:
        'Provider runners by lifecycle phase, including idle runners without an active assignment',
    },
  );
  const providerRunnersByPhaseOldestAge = meter.createObservableGauge<ProviderRunnerPhaseLabels>(
    'runners_provider_runner_by_phase_oldest_age',
    {
      description: 'Oldest provider runner age by lifecycle phase',
      unit: 'ms',
    },
  );
  const reservationLeakUnits = meter.createObservableGauge('runners_reservation_leaked_units', {
    description: 'Live reservation units without an unclaimed runner behind them',
  });
  const providerRunnersByState = meter.createObservableGauge<ProviderRunnerStateLabels>(
    'runners_provider_runner_by_state',
    {
      description: 'Active provider runners by bounded lifecycle state',
    },
  );
  const providerRunnersByStateOldestAge = meter.createObservableGauge<ProviderRunnerStateLabels>(
    'runners_provider_runner_by_state_oldest_age',
    {
      description: 'Oldest active provider runner age by bounded lifecycle state',
      unit: 'ms',
    },
  );

  meter.addBatchObservableCallback(
    async (observer) => {
      const [
        depthResult,
        staleEnrolledRunnerCountResult,
        providerRunnersByPhaseResult,
        reservationLeakUnitsResult,
        providerRunnersByStateResult,
      ] = await Promise.allSettled([
        getJobExecutionQueueDepth(),
        countStaleEnrolledRunnerInstances({
          graceSeconds: config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS,
        }),
        listProviderRunnerByPhaseMetrics(),
        countLiveReservationLeakUnits(),
        listProviderRunnerByStateMetrics(),
      ]);

      if (depthResult.status === 'fulfilled') {
        observer.observe(pendingJobExecutions, depthResult.value.pendingJobExecutions);
        observer.observe(runningJobExecutions, depthResult.value.runningJobExecutions);
      }
      if (staleEnrolledRunnerCountResult.status === 'fulfilled') {
        observer.observe(enrolledRunnersWithoutRecentReport, staleEnrolledRunnerCountResult.value);
      }
      if (providerRunnersByPhaseResult.status === 'fulfilled') {
        for (const metric of providerRunnersByPhaseResult.value) {
          const attributes: ProviderRunnerPhaseLabels = {
            phase: metric.phase,
            provider: metric.provider,
            launch_kind: metric.launchKind,
          };
          observer.observe(providerRunnersByPhase, metric.count, attributes);
          observer.observe(
            providerRunnersByPhaseOldestAge,
            metric.oldestAgeMilliseconds,
            attributes,
          );
        }
      }
      if (reservationLeakUnitsResult.status === 'fulfilled') {
        observer.observe(reservationLeakUnits, reservationLeakUnitsResult.value);
      }
      observeProviderRunnerStateMetrics(
        observer,
        providerRunnersByState,
        providerRunnersByStateOldestAge,
        providerRunnersByStateResult,
      );
    },
    [
      pendingJobExecutions,
      runningJobExecutions,
      enrolledRunnersWithoutRecentReport,
      providerRunnersByPhase,
      providerRunnersByPhaseOldestAge,
      reservationLeakUnits,
      providerRunnersByState,
      providerRunnersByStateOldestAge,
    ],
  );
}

function observeProviderRunnerStateMetrics(
  observer: {
    observe: (
      metric: ObservableGauge<ProviderRunnerStateLabels>,
      value: number,
      attributes?: ProviderRunnerStateLabels,
    ) => void;
  },
  countGauge: ObservableGauge<ProviderRunnerStateLabels>,
  ageGauge: ObservableGauge<ProviderRunnerStateLabels>,
  result: PromiseSettledResult<ProviderRunnerStateMetric[]>,
): void {
  if (result.status !== 'fulfilled') return;
  for (const metric of result.value) {
    const attributes: ProviderRunnerStateLabels = {state: metric.state};
    observer.observe(countGauge, metric.count, attributes);
    observer.observe(ageGauge, metric.oldestAgeMilliseconds, attributes);
  }
}
