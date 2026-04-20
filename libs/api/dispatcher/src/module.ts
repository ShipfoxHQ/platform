import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ShipfoxModule} from '@shipfox/node-module';
import {DISPATCHER_TASK_QUEUE, DISPATCHER_WORKFLOW_ID} from '#core/constants.js';
import {createActivities} from '#temporal/index.js';

// Temporal's webpack bundler requires a compiled .js file. Whether running from
// src/ (dev) or dist/ (prod), the parent of the current directory is the package root.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/dispatch.js');

export const dispatcherModule: ShipfoxModule = {
  name: 'dispatcher',
  workers: [
    {
      taskQueue: DISPATCHER_TASK_QUEUE,
      workflowsPath,
      activities: createActivities,
      workflows: [{name: 'outboxDispatcherWorkflow', id: DISPATCHER_WORKFLOW_ID}],
    },
  ],
};
