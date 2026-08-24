import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  DEFINITION_DELETED,
  DEFINITION_RESOLVED,
  type DefinitionsEventMap,
} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {
  INTEGRATION_EVENT_RECEIVED,
  type IntegrationsEventMap,
} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  WORKFLOWS_JOB_ACTIVATED,
  WORKFLOWS_JOB_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, triggersOutbox} from '#db/index.js';
import {registerTriggersServiceMetrics} from '#metrics/index.js';
import {triggersE2eRoutes} from '#presentation/e2e-routes.js';
import {createTriggerRoutes} from '#presentation/index.js';
import {
  createOnIntegrationEventReceived,
  onDefinitionDeleted,
  onDefinitionResolved,
  onJobActivated,
  onJobTerminated,
} from '#presentation/subscribers/index.js';
import {
  createTriggersCronActivities,
  createTriggersMaintenanceActivities,
} from '#temporal/activities/index.js';
import {TRIGGERS_CRON_TASK_QUEUE, TRIGGERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

export type {
  JobListenerMatcherKind,
  JobListenerSubscription,
} from '#core/entities/job-listener-subscription.js';
export type {TriggerSubscription} from '#core/entities/subscription.js';
export {
  createDevRun,
  DevRunInputsNotAllowedError,
  DevRunReplayEventRequiredError,
  DevRunTriggerNotFoundError,
  fireCronSubscription,
  fireManualSubscription,
  ManualTriggerNotFoundError,
  TriggerSubscriptionNotCronError,
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from '#core/index.js';
export {
  db,
  findMatchingJobListenerSubscriptions,
  findMatchingSubscriptions,
  getManualSubscriptionByDefinitionId,
  getTriggerSubscriptionById,
  jobListenerSubscriptions,
  listSubscriptionsByWorkflowDefinitionIds,
  migrationsPath,
  projectJobListenerSubscriptions,
  removeJobListenerSubscriptionsForJob,
  triggersOutbox,
} from '#db/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporalWorkflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<
  DefinitionsEventMap & IntegrationsEventMap & WorkflowsEventMapDto
>();

export interface CreateTriggersModuleOptions {
  workflows: WorkflowsModuleClient;
  definitions: DefinitionsInterModuleClient;
  projects: ProjectsModuleClient;
}

export function createTriggersModule({
  workflows,
  definitions,
  projects,
}: CreateTriggersModuleOptions): ShipfoxModule {
  return {
    name: 'triggers',
    database: {db, migrationsPath, databaseNamespace: 'triggers'},
    routes: createTriggerRoutes(workflows, definitions, projects),
    e2eRoutes: [triggersE2eRoutes],
    metrics: registerTriggersServiceMetrics,
    publishers: [{name: 'triggers', table: triggersOutbox, db}],
    subscribers: [
      subscriber(DEFINITION_RESOLVED, onDefinitionResolved),
      subscriber(DEFINITION_DELETED, onDefinitionDeleted),
      subscriber(INTEGRATION_EVENT_RECEIVED, createOnIntegrationEventReceived(workflows)),
      subscriber(WORKFLOWS_JOB_ACTIVATED, onJobActivated),
      subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
    ],
    workers: [
      {
        taskQueue: TRIGGERS_MAINTENANCE_TASK_QUEUE,
        workflowsPath: temporalWorkflowsPath,
        activities: createTriggersMaintenanceActivities,
        workflows: [
          {
            name: 'pruneTriggerEventsCron',
            id: 'triggers-prune-trigger-events',
            cronSchedule: '0 * * * *',
          },
        ],
      },
      {
        taskQueue: TRIGGERS_CRON_TASK_QUEUE,
        workflowsPath: temporalWorkflowsPath,
        activities: () => createTriggersCronActivities(workflows),
        workflows: [
          {
            name: 'cronTickCron',
            id: 'triggers-cron-tick',
            cronSchedule: '* * * * *',
          },
        ],
      },
    ],
  };
}
