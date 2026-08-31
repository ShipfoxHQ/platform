import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  WORKFLOWS_JOB_EVENT_DELIVERED,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  type WorkflowsEventMapDto,
  workflowsEventSchemas,
} from '@shipfox/api-workflows-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, workflowsOutbox} from '#db/index.js';
import {registerWorkflowsServiceMetrics} from '#metrics/index.js';
import {
  createWorkflowRoutes,
  onJobEventDelivered,
  onJobStepsSettled,
  onJobTerminatedFailureAnnotation,
  onRunnerJobClaimed,
  onRunnerJobLeaseExpired,
  onStepAttemptTerminatedFailureAnnotation,
  onWorkflowRunAttemptCreated,
  onWorkflowRunCancelled,
} from '#presentation/index.js';
import {createWorkflowsInterModulePresentation} from '#presentation/inter-module.js';
import {createOrchestrationActivities, WORKFLOWS_TASK_QUEUE} from '#temporal/index.js';

export type {
  Job,
  JobListenerEvent,
  JobListenerEventDisposition,
  RunWorkflowParams,
  Step,
  TriggerPayload,
  WorkflowRun,
  WorkflowSourceSnapshot,
} from '#core/index.js';
export {
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  isPermanentRunWorkflowError,
  ProjectMismatchError,
  runWorkflow,
  WorkflowRunNotCancellableError,
} from '#core/index.js';
export {
  closeDb,
  type DeliverEventToListenerParams,
  type DeliverEventToListenerResult,
  db,
  deliverEventToListener,
  getStepById,
  getStepByIdForJobExecution,
  migrationsPath,
  workflowsOutbox,
} from '#db/index.js';
export {loadRunningLeasedStep} from '#presentation/routes/leased-step.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMapDto & RunnersEventMap>();

export function createWorkflowsModule({
  agent,
  definitions,
  annotations,
  auth,
  integrations,
  projects,
  runners,
  secrets,
  workspaces,
}: {
  agent: AgentInterModuleClient;
  definitions: DefinitionsInterModuleClient;
  annotations: AnnotationsInterModuleClient;
  auth: AuthInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
  runners: RunnersInterModuleClient;
  secrets: SecretsInterModuleClient;
  workspaces: WorkspacesInterModuleClient;
}): ShipfoxModule {
  return {
    name: 'workflows',
    database: {db, migrationsPath, databaseNamespace: 'workflows'},
    routes: createWorkflowRoutes({
      agent,
      annotations,
      auth,
      integrations,
      projects,
      runners,
      secrets,
      workspaces,
    }),
    metrics: registerWorkflowsServiceMetrics,
    publishers: [
      {name: 'workflows', table: workflowsOutbox, db, eventSchemas: workflowsEventSchemas},
    ],
    subscribers: [
      subscriber(WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED, onWorkflowRunAttemptCreated),
      subscriber(WORKFLOWS_WORKFLOW_RUN_CANCELLED, onWorkflowRunCancelled),
      subscriber(WORKFLOWS_JOB_EVENT_DELIVERED, onJobEventDelivered),
      subscriber(WORKFLOWS_JOB_STEPS_SETTLED, onJobStepsSettled),
      subscriber(
        WORKFLOWS_STEP_ATTEMPT_TERMINATED,
        onStepAttemptTerminatedFailureAnnotation(annotations),
      ),
      subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminatedFailureAnnotation(annotations)),
      subscriber(RUNNER_JOB_LEASE_EXPIRED, onRunnerJobLeaseExpired),
      subscriber(RUNNER_JOB_CLAIMED, onRunnerJobClaimed),
    ],
    workers: [
      {
        taskQueue: WORKFLOWS_TASK_QUEUE,
        workflowsPath,
        activities: () => createOrchestrationActivities({agent, integrations, projects, secrets}),
        workflows: [],
      },
    ],
    interModulePresentations: [
      createWorkflowsInterModulePresentation({
        agent,
        definitions,
        integrations,
        projects,
        runners,
        secrets,
        workspaces,
      }),
    ],
  };
}
