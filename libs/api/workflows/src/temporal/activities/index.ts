import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  activateJobListenerActivity,
  bulkSetStepStatuses,
  createDrainListenerEventsActivity,
  evaluateJobActivationsActivity,
  failJobExecutionAsTimedOutActivity,
  failRunAsTimedOutActivity,
  loadRunAttemptDag,
  peekListenerBufferActivity,
  queueJobExecutionActivity,
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
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>;
}) {
  return {
    loadRunAttemptDag,
    setRunAttemptStatus,
    setJobStatus,
    setJobExecutionStatus: async (activityParams: Parameters<typeof setJobExecutionStatus>[0]) =>
      await setJobExecutionStatus(activityParams, params.secrets),
    bulkSetStepStatuses,
    queueJobExecutionActivity,
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
  };
}
