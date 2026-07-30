import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  activateJobListenerActivity,
  bulkSetStepStatuses,
  createCancelRunnerJobsActivity,
  createDrainListenerEventsActivity,
  createEnqueueJobExecutionForRunner,
  createReleaseLeaseActivity,
  evaluateJobActivationsActivity,
  failJobExecutionAsTimedOutActivity,
  failRunAsTimedOutActivity,
  loadRunAttemptDag,
  peekListenerBufferActivity,
  recordListenerFiringOutcomeActivity,
  resolveJobListenerActivity,
  resolveJobStatusFromJobExecutionsActivity,
  resolveLeaseExpiredJobExecutionActivity,
  setJobExecutionStatus,
  setJobStatus,
  setRunAttemptStatus,
  settleListenerJobExecutionActivity,
} from './orchestration-activities.js';

export function createOrchestrationActivities(params: {
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>;
}) {
  return {
    loadRunAttemptDag,
    setRunAttemptStatus,
    setJobStatus,
    setJobExecutionStatus: async (activityParams: Parameters<typeof setJobExecutionStatus>[0]) =>
      await setJobExecutionStatus(activityParams, params.secrets),
    bulkSetStepStatuses,
    cancelRunnerJobsActivity: createCancelRunnerJobsActivity(params.runners),
    enqueueJobExecutionForRunner: createEnqueueJobExecutionForRunner(params.runners),
    evaluateJobActivationsActivity,
    failJobExecutionAsTimedOutActivity: async (
      activityParams: Parameters<typeof failJobExecutionAsTimedOutActivity>[0],
    ) => await failJobExecutionAsTimedOutActivity(activityParams, params.secrets),
    failRunAsTimedOutActivity,
    activateJobListenerActivity,
    drainListenerEventsActivity: createDrainListenerEventsActivity({
      agent: params.agent,
      integrations: params.integrations,
      projects: params.projects,
      secrets: params.secrets,
    }),
    peekListenerBufferActivity,
    resolveJobListenerActivity,
    settleListenerJobExecutionActivity,
    recordListenerFiringOutcomeActivity,
    resolveLeaseExpiredJobExecutionActivity: async (
      activityParams: Parameters<typeof resolveLeaseExpiredJobExecutionActivity>[0],
    ) => await resolveLeaseExpiredJobExecutionActivity(activityParams, params.secrets),
    resolveJobStatusFromJobExecutionsActivity,
    releaseLeaseActivity: createReleaseLeaseActivity(params.runners),
  };
}
