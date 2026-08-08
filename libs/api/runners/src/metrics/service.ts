import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {getJobExecutionQueueDepth} from '#db/job-executions.js';
import {
  countStaleEnrolledRunnerInstances,
  listProvisionedRunnerPendingMetrics,
  type ProvisionedRunnerPendingMetric,
} from '#db/runner-instances.js';

type PendingProvisionedRunnerLabels = {
  phase: ProvisionedRunnerPendingMetric['phase'];
  provider: string;
  launch_kind: ProvisionedRunnerPendingMetric['launchKind'];
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
  const pendingProvisionedRunners = meter.createObservableGauge<PendingProvisionedRunnerLabels>(
    'runners_provisioned_runner_pending',
    {
      description:
        'Provisioned runners by lifecycle phase, including idle runners without an active assignment',
    },
  );
  const pendingProvisionedRunnersOldestAge =
    meter.createObservableGauge<PendingProvisionedRunnerLabels>(
      'runners_provisioned_runner_pending_oldest_age_seconds',
      {
        description: 'Oldest provisioned runner backlog age by lifecycle phase',
        unit: 's',
      },
    );

  meter.addBatchObservableCallback(
    async (observer) => {
      const [depthResult, staleEnrolledRunnerCountResult, pendingProvisionedRunnersResult] =
        await Promise.allSettled([
          getJobExecutionQueueDepth(),
          countStaleEnrolledRunnerInstances({
            graceSeconds: config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS,
          }),
          listProvisionedRunnerPendingMetrics(),
        ]);

      if (depthResult.status === 'fulfilled') {
        observer.observe(pendingJobExecutions, depthResult.value.pendingJobExecutions);
        observer.observe(runningJobExecutions, depthResult.value.runningJobExecutions);
      }
      if (staleEnrolledRunnerCountResult.status === 'fulfilled') {
        observer.observe(enrolledRunnersWithoutRecentReport, staleEnrolledRunnerCountResult.value);
      }
      if (pendingProvisionedRunnersResult.status === 'fulfilled') {
        for (const pending of pendingProvisionedRunnersResult.value) {
          const attributes: PendingProvisionedRunnerLabels = {
            phase: pending.phase,
            provider: pending.provider,
            launch_kind: pending.launchKind,
          };
          observer.observe(pendingProvisionedRunners, pending.count, attributes);
          observer.observe(
            pendingProvisionedRunnersOldestAge,
            pending.oldestAgeSeconds,
            attributes,
          );
        }
      }
    },
    [
      pendingJobExecutions,
      runningJobExecutions,
      enrolledRunnersWithoutRecentReport,
      pendingProvisionedRunners,
      pendingProvisionedRunnersOldestAge,
    ],
  );
}
