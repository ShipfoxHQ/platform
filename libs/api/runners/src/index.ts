import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {administrationActionEventSchemas} from '@shipfox/api-common-dto';
import {runnersEventSchemas} from '@shipfox/api-runners-dto';
import {
  WORKFLOWS_JOB_EXECUTION_QUEUED,
  WORKFLOWS_JOB_EXECUTION_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db, migrationsPath, runnersOutbox} from '#db/index.js';
import type {CreateRunnersModuleOptions} from '#installation-provisioning.js';
import {registerRunnersServiceMetrics} from '#metrics/index.js';
import {
  createProvisionerTokenAuthMethod,
  createRunnerControlSessionAuthMethod,
  createRunnerRegistrationTokenAuthMethod,
  createRunnerRoutes,
  onWorkflowsJobExecutionQueued,
  onWorkflowsJobExecutionTerminated,
} from '#presentation/index.js';
import {createRunnersInterModulePresentation} from '#presentation/inter-module.js';
import {createRunnersMaintenanceActivities} from '#temporal/activities/index.js';
import {RUNNERS_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

const runnersPublisherEventSchemas = {...runnersEventSchemas, ...administrationActionEventSchemas};

export {
  type EffectiveRunnerToolCapabilitiesResult,
  getEffectiveRunnerToolCapabilities,
  unadvertisedRunnerTools,
} from '#core/runner-tool-capabilities.js';
export {
  getWorkspaceJobCounts,
  isJobLeaseActive,
} from '#db/index.js';
export type {
  CreateRunnersModuleOptions,
  InstallationProvisioningPolicy,
} from '#installation-provisioning.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMapDto>();

export function createRunnersModule({
  auth,
  ...options
}: CreateRunnersModuleOptions & {auth: AuthInterModuleClient}): ShipfoxModule {
  return {
    name: 'runners',
    database: {db, migrationsPath, databaseNamespace: 'runners'},
    auth: [
      createRunnerRegistrationTokenAuthMethod(),
      createRunnerControlSessionAuthMethod(),
      createProvisionerTokenAuthMethod(),
    ],
    routes: createRunnerRoutes(auth, options),
    metrics: registerRunnersServiceMetrics,
    publishers: [
      {name: 'runners', table: runnersOutbox, db, eventSchemas: runnersPublisherEventSchemas},
    ],
    subscribers: [
      subscriber(WORKFLOWS_JOB_EXECUTION_QUEUED, onWorkflowsJobExecutionQueued),
      subscriber(WORKFLOWS_JOB_EXECUTION_TERMINATED, onWorkflowsJobExecutionTerminated),
    ],
    workers: [
      {
        taskQueue: RUNNERS_MAINTENANCE_TASK_QUEUE,
        workflowsPath,
        activities: createRunnersMaintenanceActivities,
        workflows: [
          {name: 'stuckJobDetector', id: 'stuck-job-detector', cronSchedule: '* * * * *'},
        ],
      },
    ],
    interModulePresentations: [createRunnersInterModulePresentation()],
  };
}
