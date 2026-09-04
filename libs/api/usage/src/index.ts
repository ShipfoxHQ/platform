import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnersEventMap,
} from '@shipfox/api-runners-dto';
import {usageEventSchemas} from '@shipfox/api-usage-dto';
import {
  WORKFLOWS_JOB_EXECUTION_QUEUED,
  WORKFLOWS_JOB_EXECUTION_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {usageOutbox} from '#db/schema/outbox.js';
import {createUsageInterModulePresentation} from '#presentation/inter-module.js';
import {usageRoutes} from '#presentation/routes/index.js';
import {onJobClaimed} from '#presentation/subscribers/on-job-claimed.js';
import {onJobExecutionQueued} from '#presentation/subscribers/on-job-execution-queued.js';
import {onJobExecutionTerminated} from '#presentation/subscribers/on-job-execution-terminated.js';
import {onJobLeaseExpired} from '#presentation/subscribers/on-job-lease-expired.js';
import {createUsageActivities} from '#temporal/activities/index.js';
import {
  USAGE_RETENTION_CRON_ID,
  USAGE_RETENTION_CRON_SCHEDULE,
  USAGE_RETENTION_TASK_QUEUE,
} from '#temporal/constants.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');
const subscriber = subscriberFactory<WorkflowsEventMapDto & RunnersEventMap>();

export function createUsageModule(): ShipfoxModule {
  return {
    name: 'usage',
    database: {db, migrationsPath, databaseNamespace: 'usage'},
    routes: usageRoutes,
    interModulePresentations: [createUsageInterModulePresentation()],
    publishers: [
      {
        name: 'usage',
        table: usageOutbox,
        db,
        eventSchemas: usageEventSchemas,
      },
    ],
    subscribers: [
      subscriber(WORKFLOWS_JOB_EXECUTION_QUEUED, onJobExecutionQueued),
      subscriber(RUNNER_JOB_CLAIMED, onJobClaimed),
      subscriber(RUNNER_JOB_LEASE_EXPIRED, onJobLeaseExpired),
      subscriber(WORKFLOWS_JOB_EXECUTION_TERMINATED, onJobExecutionTerminated),
    ],
    workers: [
      {
        taskQueue: USAGE_RETENTION_TASK_QUEUE,
        workflowsPath,
        activities: createUsageActivities,
        workflows: [
          {
            name: 'usageRetentionCron',
            id: USAGE_RETENTION_CRON_ID,
            cronSchedule: USAGE_RETENTION_CRON_SCHEDULE,
          },
        ],
      },
    ],
  };
}

export {dropExpiredUsagePartitions} from '#db/retention.js';
