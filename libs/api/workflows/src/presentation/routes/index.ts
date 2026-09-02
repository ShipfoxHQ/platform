import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {AUTH_LEASED_JOB, AUTH_USER} from '@shipfox/api-auth-context';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createAgentRuntimeConfigRoute} from './agent-runtime-config.js';
import {cancelRunRoute} from './cancel-run.js';
import {createCheckoutTokenRoute} from './checkout-token.js';
import {getJobDetailRoute} from './get-job-detail.js';
import {getJobExecutionContextRoute} from './get-job-execution-context.js';
import {getRunRoute} from './get-run.js';
import {getRunAggregatesRoute} from './get-run-aggregates.js';
import {getRunLineageHeadRoute} from './get-run-lineage-head.js';
import {getRunOverviewRoute} from './get-run-overview.js';
import {getRunSelectionRoute} from './get-run-selection.js';
import {getRunSourceRoute} from './get-run-source.js';
import {getStepAttemptDetailRoute} from './get-step-attempt-detail.js';
import {createGetStepSecretsRoute} from './get-step-secrets.js';
import {listExecutionStepsRoute} from './list-execution-steps.js';
import {listJobExecutionsRoute} from './list-job-executions.js';
import {listRunAnnotationsRoute} from './list-run-annotations.js';
import {listRunAttemptsRoute} from './list-run-attempts.js';
import {listRunJobExplanationsRoute} from './list-run-job-explanations.js';
import {listRunJobsRoute} from './list-run-jobs.js';
import {listRunsRoute} from './list-runs.js';
import {listStepAttemptsRoute} from './list-step-attempts.js';
import {createNextStepRoute} from './next-step.js';
import {createReportStepRoute} from './report-step.js';
import {rerunRunRoute} from './rerun-run.js';

type WorkflowRouteClients = {
  agent: AgentInterModuleClient;
  annotations: AnnotationsInterModuleClient;
  auth: AuthInterModuleClient;
  integrations: IntegrationsModuleClient;
  toolStepExecutor?: {nudge(): void};
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
  secrets: SecretsInterModuleClient;
  workspaces: WorkspacesInterModuleClient;
};

type LeaseTokenRouteClients = Omit<WorkflowRouteClients, 'workspaces'>;

export function createLeaseTokenRouteGroup(params: LeaseTokenRouteClients): RouteGroup {
  return {
    // The lease token names the job, so the path carries no job id ("current").
    prefix: '/runs/jobs/current',
    auth: AUTH_LEASED_JOB,
    routes: [
      createNextStepRoute(params),
      createReportStepRoute(params.runners),
      createCheckoutTokenRoute({
        annotations: params.annotations,
        integrations: params.integrations,
        projects: params.projects,
        runners: params.runners,
      }),
      createAgentRuntimeConfigRoute(params),
      createGetStepSecretsRoute(params.runners, params.secrets),
    ],
  };
}

export function createWorkflowRoutes(params: WorkflowRouteClients): RouteGroup[] {
  return [
    {
      prefix: '/workflows/runs',
      auth: AUTH_USER,
      routes: [
        listRunsRoute(params.projects),
        getRunAggregatesRoute(params.projects),
        getRunLineageHeadRoute(params.projects),
        getRunSelectionRoute(params.projects),
        listRunAttemptsRoute(params.projects),
        getRunOverviewRoute(params.projects),
        getJobExecutionContextRoute(params.projects),
        getJobDetailRoute(params.projects),
        listJobExecutionsRoute(params.projects),
        listExecutionStepsRoute(params.projects),
        listStepAttemptsRoute(params.projects),
        listRunJobsRoute(params.projects),
        listRunAnnotationsRoute(params.annotations, params.projects),
        listRunJobExplanationsRoute(params.projects),
        getRunSourceRoute(params.projects),
        getRunRoute(params.projects),
        getStepAttemptDetailRoute(params.projects),
        cancelRunRoute(params.projects),
        rerunRunRoute(params.projects, params.workspaces, params.agent),
      ],
    },
    createLeaseTokenRouteGroup(params),
  ];
}
