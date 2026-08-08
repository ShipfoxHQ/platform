import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {getJobExecutionQueueDepth} from '#db/job-executions.js';
import {
  countStaleEnrolledRunnerInstances,
  listProviderRunnerByPhaseMetrics,
  type ProviderRunnerPhaseMetric,
} from '#db/runner-instances.js';

type ProviderRunnerPhaseLabels = {
  phase: ProviderRunnerPhaseMetric['phase'];
  provider: string;
  launch_kind: ProviderRunnerPhaseMetric['launchKind'];
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

  meter.addBatchObservableCallback(
    async (observer) => {
      const [depthResult, staleEnrolledRunnerCountResult, providerRunnersByPhaseResult] =
        await Promise.allSettled([
          getJobExecutionQueueDepth(),
          countStaleEnrolledRunnerInstances({
            graceSeconds: config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS,
          }),
          listProviderRunnerByPhaseMetrics(),
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
    },
    [
      pendingJobExecutions,
      runningJobExecutions,
      enrolledRunnersWithoutRecentReport,
      providerRunnersByPhase,
      providerRunnersByPhaseOldestAge,
    ],
  );
}
