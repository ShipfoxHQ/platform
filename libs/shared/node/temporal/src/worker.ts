import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {NativeConnection, Worker, type WorkerOptions} from '@temporalio/worker';
import {loadProductionWorkflowBundle} from './bundle.js';
import {config} from './config.js';
import {getTemporalConnectionOptions, temporalConnectionError} from './connection-options.js';
import {
  getWorkerInterceptors,
  getWorkflowInterceptorModules,
  getWorkflowSinks,
} from './interceptors.js';
import {installTemporalRuntime} from './runtime.js';
import type {WorkflowErrorReport} from './workflow-error-interceptor.js';

export interface CreateWorkerOptions {
  connection?: NativeConnection;
  taskQueue?: string;
  workflowsPath: string;
  activities: object;
  maxConcurrentActivityTaskExecutions?: number;
  maxConcurrentWorkflowTaskExecutions?: number;
}

function resolveWorkflowSource(
  workflowsPath: string,
): Pick<WorkerOptions, 'workflowsPath' | 'workflowBundle' | 'interceptors'> {
  if (process.env.NODE_ENV === 'production') {
    return {workflowBundle: loadProductionWorkflowBundle(workflowsPath)};
  }

  return {
    workflowsPath,
    interceptors: {workflowModules: getWorkflowInterceptorModules()},
  };
}

export async function createTemporalWorkerConnection(): Promise<NativeConnection> {
  installTemporalRuntime();
  try {
    return await NativeConnection.connect(getTemporalConnectionOptions());
  } catch (error) {
    throw temporalConnectionError(error);
  }
}

export async function createTemporalWorker(options: CreateWorkerOptions): Promise<Worker> {
  installTemporalRuntime();
  const taskQueue = options.taskQueue ?? config.TEMPORAL_TASK_QUEUE;
  const workflowSource = resolveWorkflowSource(options.workflowsPath);
  const {interceptors: workflowInterceptors, ...workflowOptions} = workflowSource;
  const connection = options.connection ?? (await createTemporalWorkerConnection());

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue,
    activities: options.activities,
    sinks: {
      ...getWorkflowSinks(),
      shipfoxErrorMonitoring: {
        reportWorkflowError: {
          callDuringReplay: false,
          fn: (_info, report: WorkflowErrorReport) => {
            const error = new Error(report.message);
            error.name = report.name;
            if (report.stack) error.stack = report.stack;
            logger().error(
              {
                err: error,
                workflowType: report.workflowType,
                taskQueue: report.taskQueue,
                workflowId: report.workflowId,
                runId: report.runId,
                attempt: report.attempt,
              },
              'Temporal workflow failed unexpectedly',
            );
            reportError(error, {
              boundary: 'temporal.workflow',
              tags: {workflowType: report.workflowType, taskQueue: report.taskQueue},
              extra: {
                workflowId: report.workflowId,
                runId: report.runId,
                attempt: report.attempt,
              },
            });
          },
        },
      },
    },
    interceptors: {
      ...getWorkerInterceptors(),
      ...workflowInterceptors,
    },
    ...workflowOptions,
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions ?? 10,
    maxConcurrentWorkflowTaskExecutions: options.maxConcurrentWorkflowTaskExecutions ?? 10,
  });

  logger().info({taskQueue, namespace: config.TEMPORAL_NAMESPACE}, 'Temporal worker created');

  return worker;
}

export function requestTemporalWorkerShutdown(worker: Worker): void {
  if (worker.getState() !== 'RUNNING') return;
  worker.shutdown();
}
