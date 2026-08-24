import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LOG_STREAM_CLOSED, type LogsEventMap, logsEventSchemas} from '@shipfox/api-logs-dto';
import {
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  type WorkflowsEventMapDto,
} from '@shipfox/api-workflows-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {type ShipfoxModule, subscriberFactory} from '@shipfox/node-module';
import {validateLogStreamReapAfterSeconds} from '#config.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {logsOutbox} from '#db/schema/outbox.js';
import {registerLogsServiceMetrics} from '#metrics/service.js';
import {createLogsInterModulePresentation} from '#presentation/inter-module.js';
import {createLogsRoutes} from '#presentation/routes/index.js';
import {onJobTerminated} from '#presentation/subscribers/on-job-terminated.js';
import {onLogStreamClosed} from '#presentation/subscribers/on-log-stream-closed.js';
import {onStepAttemptTerminated} from '#presentation/subscribers/on-step-attempt-terminated.js';
import {createLogsActivities} from '#temporal/activities/index.js';
import {LOGS_COMPACTION_TASK_QUEUE, LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

export {checkBucketReachable} from '#api/object-storage.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

const subscriber = subscriberFactory<WorkflowsEventMapDto & LogsEventMap>();

export function createLogsModule({
  workflows,
  jobLeaseTokenTtlSeconds,
}: {
  workflows: WorkflowsModuleClient;
  jobLeaseTokenTtlSeconds: number;
}): ShipfoxModule {
  validateLogStreamReapAfterSeconds(jobLeaseTokenTtlSeconds);

  return {
    name: 'logs',
    database: {db, migrationsPath, databaseNamespace: 'logs'},
    routes: createLogsRoutes(workflows),
    metrics: registerLogsServiceMetrics,
    interModulePresentations: [createLogsInterModulePresentation()],
    // `logs.stream.closed` is written by the close paths: the job-terminated subscriber
    // force-closes streams the runner never ended, and the closed event drives compaction.
    publishers: [{name: 'logs', table: logsOutbox, db, eventSchemas: logsEventSchemas}],
    subscribers: [
      subscriber(WORKFLOWS_STEP_ATTEMPT_TERMINATED, onStepAttemptTerminated),
      subscriber(WORKFLOWS_JOB_TERMINATED, onJobTerminated),
      subscriber(LOG_STREAM_CLOSED, onLogStreamClosed),
    ],
    workers: [
      {
        taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
        workflowsPath,
        activities: createLogsActivities,
        // Temporal cron schedules are fixed after creation, so making cadence configurable would
        // look adjustable while keeping the old schedule. Tune LOG_RETENTION_DAYS for the horizon.
        workflows: [
          {
            name: 'retentionSweepCron',
            id: 'logs-retention-sweep',
            cronSchedule: '0 * * * *',
          },
          // Offset from retention's top-of-hour sweep; stale-stream age is governed by
          // LOG_STREAM_REAP_AFTER_SECONDS.
          {
            name: 'reapStaleOpenStreamsCron',
            id: 'logs-reap-stale-open-streams',
            cronSchedule: '5,15,25,35,45,55 * * * *',
          },
        ],
      },
      // Compaction runs on its own queue so long uploads cannot starve the lifecycle sweep.
      {
        taskQueue: LOGS_COMPACTION_TASK_QUEUE,
        workflowsPath,
        activities: createLogsActivities,
        workflows: [
          {
            name: 'compactionReconcileCron',
            id: 'logs-compaction-reconcile',
            cronSchedule: '*/10 * * * *',
          },
        ],
      },
    ],
  };
}
