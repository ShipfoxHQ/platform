import {getServiceMetricsProvider} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {getJobExecutionQueueDepth} from '#db/job-executions.js';
import {
  countStaleEnrolledRunnerInstances,
  listProvisionedRunnerPendingMetrics,
} from '#db/runner-instances.js';

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
  const pendingProvisionedRunners = meter.createObservableGauge(
    'runners_provider_runners_pending',
    {
      description:
        'Provisioned runners waiting for control-session creation, enrollment, reservation assignment, or activation',
    },
  );
  const pendingProvisionedRunnersOldestAge = meter.createObservableGauge(
    'runners_provider_runners_pending_oldest_age',
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
          const attributes = {
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
