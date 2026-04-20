import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNNER_JOB_COMPLETED} from '@shipfox/api-runners-dto';
import {WORKFLOW_RUN_CREATED} from '@shipfox/api-workflows-dto';
import type {ShipfoxModule} from '@shipfox/node-module';
import {db, migrationsPath, workflowsOutbox} from '#db/index.js';
import {onRunnerJobCompleted, onWorkflowRunCreated, routes} from '#presentation/index.js';
import {createOrchestrationActivities, WORKFLOWS_TASK_QUEUE} from '#temporal/index.js';

export type {Job, RunWorkflowParams, Step, TriggerContext, WorkflowRun} from '#core/index.js';
export {DefinitionNotFoundError, ProjectMismatchError, runWorkflow} from '#core/index.js';
export {db, migrationsPath, workflowsOutbox} from '#db/index.js';
export {routes} from '#presentation/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export const workflowsModule: ShipfoxModule = {
  name: 'workflows',
  database: {db, migrationsPath},
  routes,
  publishers: [{name: 'workflows', table: workflowsOutbox, db}],
  subscribers: [
    {event: WORKFLOW_RUN_CREATED, handler: onWorkflowRunCreated},
    {event: RUNNER_JOB_COMPLETED, handler: onRunnerJobCompleted},
  ],
  workers: [
    {
      taskQueue: WORKFLOWS_TASK_QUEUE,
      workflowsPath,
      activities: createOrchestrationActivities,
      workflows: [],
    },
  ],
};
