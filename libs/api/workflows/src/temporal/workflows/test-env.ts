import {resolve} from 'node:path';
import {TestWorkflowEnvironment} from '@temporalio/testing';
import {Worker} from '@temporalio/worker';
import type {CompletionStatus} from '#core/dag.js';
import type {RunDag} from '../activities/orchestration-activities.js';

const TASK_QUEUE = 'test-orchestration';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

export {TASK_QUEUE};

// ---------------------------------------------------------------------------
// Shared mutable test config — each test sets this before starting a workflow.
// Activities read from it via closure. Tests run serially within a describe.
// ---------------------------------------------------------------------------

export interface TestConfig {
  dag: RunDag;
  /** Map of jobId → status the mock runner should signal back */
  jobResults: Map<string, CompletionStatus>;
  /** If set, enqueueJobForRunner will throw with this message instead of signaling */
  enqueueError?: string;
  /** If true, enqueueJobForRunner sends two signals (for dedup testing) */
  duplicateSignal?: boolean;
  /** If true, enqueueJobForRunner does nothing (no signal — for timeout testing) */
  skipSignal?: boolean;
}

export let cfg: TestConfig;

export function setCfg(value: TestConfig): void {
  cfg = value;
}

// Track every activity call for assertions
export interface ActivityCall {
  name: string;
  params: unknown;
}

export let calls: ActivityCall[];
let versionSeq: number;

function nextVersion(): number {
  return ++versionSeq;
}

export function resetCalls(): void {
  calls = [];
  versionSeq = 0;
}

export function callsNamed(name: string): ActivityCall[] {
  return calls.filter((c) => c.name === name);
}

export function setRunStatusCalls() {
  return callsNamed('setRunStatus') as Array<{
    name: string;
    params: {runId: string; status: string; version: number};
  }>;
}

export function setJobStatusCalls() {
  return callsNamed('setJobStatus') as Array<{
    name: string;
    params: {jobId: string; status: string; version: number};
  }>;
}

// ---------------------------------------------------------------------------
// DAG helpers
// ---------------------------------------------------------------------------

export function dagJob(id: string, name: string, deps: string[] = []): RunDag['jobs'][number] {
  return {
    id,
    name,
    status: 'pending',
    dependencies: deps,
    version: 1,
    steps: [{id: `${id}-step`, name: null, type: 'run', config: {cmd: 'echo'}, position: 0}],
  };
}

export function makeDag(jobs: RunDag['jobs'], runId = 'run-1'): RunDag {
  return {runId, workspaceId: 'workspace-1', runVersion: 1, jobs};
}

// ---------------------------------------------------------------------------
// Environment lifecycle
// ---------------------------------------------------------------------------

export let testEnv: TestWorkflowEnvironment;
export let worker: Worker;

let workerRunPromise: Promise<void> | undefined;

export async function setupEnv(): Promise<void> {
  testEnv = await TestWorkflowEnvironment.createLocal();

  worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createMockActivities(),
  });

  // Run worker in background — it processes tasks until shutdown is called
  workerRunPromise = worker.run();
  workerRunPromise.catch(() => {
    // Suppress unhandled rejection on shutdown
  });
}

export async function teardownEnv(): Promise<void> {
  worker?.shutdown();
  await workerRunPromise;
  await testEnv?.teardown();
}

function createMockActivities() {
  return {
    loadRunDag: (runId: string): RunDag => {
      calls.push({name: 'loadRunDag', params: runId});
      return cfg.dag;
    },

    setRunStatus: (params: {runId: string; status: string; version: number}) => {
      calls.push({name: 'setRunStatus', params});
      return {newVersion: nextVersion()};
    },

    setJobStatus: (params: {jobId: string; status: string; version: number}) => {
      calls.push({name: 'setJobStatus', params});
      return {newVersion: nextVersion()};
    },

    bulkSetStepStatuses: (params: {jobId: string; status: string}) => {
      calls.push({name: 'bulkSetStepStatuses', params});
    },

    enqueueJobForRunner: async (params: {
      workspaceId: string;
      jobId: string;
      runId: string;
      jobName: string;
      steps: unknown[];
    }) => {
      calls.push({name: 'enqueueJobForRunner', params});

      if (cfg.enqueueError) {
        const {ApplicationFailure} = await import('@temporalio/common');
        throw ApplicationFailure.nonRetryable(cfg.enqueueError);
      }

      if (cfg.skipSignal) return;

      const status = cfg.jobResults.get(params.jobId) ?? 'succeeded';
      const handle = testEnv.client.workflow.getHandle(`job:${params.jobId}`);
      await handle.signal('job-completed', {status});

      if (cfg.duplicateSignal) {
        await handle.signal('job-completed', {status: 'failed', output: 'duplicate'});
      }
    },
  };
}
