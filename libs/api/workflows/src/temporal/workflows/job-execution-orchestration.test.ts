import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {bundleProductionWorkflow} from '@shipfox/node-temporal';
import {Worker} from '@temporalio/worker';
import {
  callsNamed,
  dagJob,
  makeDag,
  resetCalls,
  setCfg,
  setExecutionStatusCalls,
  setJobStatusCalls,
  setupEnv,
  TASK_QUEUE,
  teardownEnv,
  testEnv,
} from './test-env.js';

const PREBUILT_WORKFLOW_TASK_QUEUE = 'test-prebuilt-workflow-bundle';
const WORKFLOWS_PATH = resolve(import.meta.dirname, '../../../dist/temporal/workflows/index.js');

beforeAll(async () => {
  await setupEnv();
}, 15_000);

afterAll(async () => {
  await teardownEnv();
}, 15_000);

beforeEach(() => {
  resetCalls();
});

const defaultJobInput = {
  workspaceId: 'workspace-1',
  jobId: 'job-1',
  workflowRunId: 'run-1',
  projectId: 'project-1',
  jobVersion: 1,
  jobExecutionId: 'job-1',
  executionVersion: 1,
  requiredLabels: ['ubuntu22'],
};

function executeJob(
  input: typeof defaultJobInput & {executionTimeoutMs?: number | undefined},
): Promise<{status: string; jobVersion: number}> {
  const normalized = {
    ...input,
    jobExecutionId:
      input.jobExecutionId === defaultJobInput.jobExecutionId &&
      input.jobId !== defaultJobInput.jobId
        ? input.jobId
        : input.jobExecutionId,
  };
  return testEnv.client.workflow.execute('jobExecutionOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job:${input.jobId}`,
    args: [normalized],
  });
}

function finalStatusesFor(jobId: string): string[] {
  return setExecutionStatusCalls()
    .filter((c) => c.params.jobExecutionId === jobId)
    .map((c) => c.params.status);
}

function terminalSetJobCall(jobId: string) {
  return setExecutionStatusCalls().find(
    (call) => call.params.jobExecutionId === jobId && call.params.status !== 'running',
  );
}

async function expectEmptyRequiredLabelsFailure(input: typeof defaultJobInput): Promise<void> {
  let error: unknown;

  try {
    await executeJob(input);
  } catch (err) {
    error = err;
  }

  expect(error).toMatchObject({
    cause: expect.objectContaining({
      message: `Job ${input.jobId} has no required runner labels`,
      nonRetryable: true,
      type: 'EmptyRequiredLabelsError',
    }),
  });
}

describe('jobExecutionOrchestration', () => {
  test('runner claim flips status to running, then finished releases the lease', async () => {
    setCfg({
      dag: makeDag([dagJob('job-1', 'build')]),
      jobResults: new Map([['job-1', 'succeeded']]),
    });

    const result = await executeJob(defaultJobInput);

    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-1')).toEqual(['running', 'succeeded']);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(0);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('keeps an execution pending until the current runner claim', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobExecutionOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-pending-before-claim',
      args: [
        {
          ...defaultJobInput,
          jobId: 'job-pending-before-claim',
          jobExecutionId: 'job-pending-before-claim',
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(setExecutionStatusCalls()).toHaveLength(0);

    await handle.signal('job-claimed', {
      jobExecutionId: 'job-pending-before-claim',
      claimedAt: '2026-06-22T10:05:00.000Z',
    });
    await handle.signal('job-finished', {
      jobExecutionId: 'job-pending-before-claim',
      status: 'succeeded',
    });

    const result = await handle.result();
    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-pending-before-claim')).toEqual(['running', 'succeeded']);
  });

  test('ignores stale and duplicate claims and transitions exactly once', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobExecutionOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-claim-idempotent',
      args: [
        {
          ...defaultJobInput,
          jobId: 'job-claim-idempotent',
          jobExecutionId: 'execution-current',
        },
      ],
    });

    await handle.signal('job-claimed', {
      jobExecutionId: 'execution-stale',
      claimedAt: '2026-06-22T10:04:00.000Z',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(setExecutionStatusCalls()).toHaveLength(0);

    const claim = {
      jobExecutionId: 'execution-current',
      claimedAt: '2026-06-22T10:05:00.000Z',
    };
    await handle.signal('job-claimed', claim);
    await handle.signal('job-claimed', {...claim, claimedAt: '2026-06-22T10:06:00.000Z'});
    await new Promise((resolve) => setTimeout(resolve, 100));
    await handle.signal('job-finished', {
      jobExecutionId: 'execution-current',
      status: 'succeeded',
    });

    const result = await handle.result();
    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('execution-current')).toEqual(['running', 'succeeded']);
  });

  test('a finish before a delayed claim remains terminal', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobExecutionOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-finish-before-claim',
      args: [
        {
          ...defaultJobInput,
          jobId: 'job-finish-before-claim',
          jobExecutionId: 'job-finish-before-claim',
        },
      ],
    });

    await handle.signal('job-finished', {
      jobExecutionId: 'job-finish-before-claim',
      status: 'succeeded',
    });
    const result = await handle.result();

    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-finish-before-claim')).toEqual(['succeeded']);
    await expect(
      handle.signal('job-claimed', {
        jobExecutionId: 'job-finish-before-claim',
        claimedAt: '2026-06-22T10:05:00.000Z',
      }),
    ).rejects.toThrow();
  });

  test('empty required labels fail before the job is marked running', async () => {
    setCfg({
      dag: makeDag([dagJob('job-empty-labels', 'build')]),
      jobResults: new Map([['job-empty-labels', 'succeeded']]),
    });

    await expectEmptyRequiredLabelsFailure({
      ...defaultJobInput,
      jobId: 'job-empty-labels',
      requiredLabels: [],
    });

    expect(setExecutionStatusCalls()).toHaveLength(0);
    expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(0);
  });

  test('whitespace-only required labels fail before the job is marked running', async () => {
    setCfg({
      dag: makeDag([dagJob('job-blank-labels', 'build')]),
      jobResults: new Map([['job-blank-labels', 'succeeded']]),
    });

    await expectEmptyRequiredLabelsFailure({
      ...defaultJobInput,
      jobId: 'job-blank-labels',
      requiredLabels: ['  '],
    });

    expect(setExecutionStatusCalls()).toHaveLength(0);
    expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(0);
  });

  test('finished signal (failed) flips status without sweeping steps', async () => {
    setCfg({dag: makeDag([dagJob('job-2', 'build')]), jobResults: new Map([['job-2', 'failed']])});

    const result = await executeJob({...defaultJobInput, jobId: 'job-2'});

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-2')).toEqual(['running', 'failed']);
    expect(terminalSetJobCall('job-2')?.params.statusReason).toBe('step_failed');
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('bulkSetStepStatuses')).toHaveLength(0);
  });

  test('job status resolution failure fails the job closed', async () => {
    setCfg({
      dag: makeDag([dagJob('job-resolve-fail', 'build')]),
      jobResults: new Map([['job-resolve-fail', 'succeeded']]),
      resolveJobStatusError: 'invalid job success expression',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-resolve-fail'});

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-resolve-fail')).toEqual(['running', 'succeeded']);
    expect(setJobStatusCalls()).toContainEqual({
      name: 'setJobStatus',
      params: {
        jobId: 'job-resolve-fail',
        status: 'failed',
        version: 1,
        statusReason: 'step_failed',
      },
    });
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
  });

  test('lease-expired signal resolves via the activity and releases the lease', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map(),
      signalLeaseExpired: true,
      leaseExpiredStatus: 'failed',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-le'});

    expect(result.status).toBe('failed');
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(1);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(1);
    expect(callsNamed('failJobExecutionAsTimedOutActivity')).toHaveLength(0);
  });

  test('lease-expired adoption: resolver reports succeeded → job succeeds (server state wins)', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map(),
      signalLeaseExpired: true,
      leaseExpiredStatus: 'succeeded',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-le2'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(1);
  });

  test('both signals: finished wins, lease-expiry is ignored', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-both', 'succeeded']]),
      signalBoth: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-both'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(0);
  });

  test('both signals with finished=failed: fails via the finished path, one terminal setJobStatus', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-bf', 'failed']]),
      signalBoth: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-bf'});

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-bf').filter((s) => s !== 'running')).toEqual(['failed']);
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(0);
  });

  test('duplicate finished signal: first wins', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-dup', 'succeeded']]),
      duplicateSignal: true,
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-dup'});

    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('job-dup').filter((s) => s !== 'running')).toEqual(['succeeded']);
  });

  test('ignores finished signals for a stale job execution', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobExecutionOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-stale-finished',
      args: [
        {
          ...defaultJobInput,
          jobId: 'job-stale-finished',
          jobExecutionId: 'execution-current',
        },
      ],
    });
    await handle.signal('job-finished', {status: 'failed', jobExecutionId: 'execution-old'});
    await new Promise((r) => setTimeout(r, 1000));
    const description = await handle.describe();

    await handle.signal('job-finished', {status: 'succeeded', jobExecutionId: 'execution-current'});
    const result = await handle.result();

    expect(description.status.name).toBe('RUNNING');
    expect(result.status).toBe('succeeded');
    expect(finalStatusesFor('execution-current').filter((s) => s !== 'running')).toEqual([
      'succeeded',
    ]);
  }, 15_000);

  test('already-terminal job is not reopened after a claim', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map(),
      runningJobStatus: 'cancelled',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-cancelled'});

    expect(result).toMatchObject({status: 'cancelled'});
    expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(1);
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(0);
  });

  test('releaseLease failure does not block the result (best-effort)', async () => {
    setCfg({
      dag: makeDag([]),
      jobResults: new Map([['job-rl', 'succeeded']]),
      releaseLeaseError: 'runners db down',
    });

    const result = await executeJob({...defaultJobInput, jobId: 'job-rl'});

    expect(result.status).toBe('succeeded');
    expect(callsNamed('releaseLeaseActivity').length).toBeGreaterThanOrEqual(1);
  });

  test('times out after the execution deadline and fails its steps without releasing the lease', async () => {
    setCfg({
      dag: makeDag([dagJob('job-timeout', 'build')]),
      jobResults: new Map(),
      skipSignal: true,
    });

    const result = await executeJob({
      ...defaultJobInput,
      jobId: 'job-timeout',
      executionTimeoutMs: 250,
    });

    expect(result.status).toBe('failed');
    expect(callsNamed('failJobExecutionAsTimedOutActivity')).toHaveLength(1);
    expect(finalStatusesFor('job-timeout')).toEqual([]);
    expect(callsNamed('bulkSetStepStatuses')).toContainEqual({
      name: 'bulkSetStepStatuses',
      params: {jobExecutionId: 'job-timeout', status: 'failed'},
    });
    expect(callsNamed('releaseLeaseActivity')).toHaveLength(0);
    expect(callsNamed('resolveLeaseExpiredJobExecutionActivity')).toHaveLength(0);
  });

  test('does not reset the execution deadline after claim', async () => {
    setCfg({
      dag: makeDag([dagJob('job-claim-timeout', 'build')]),
      jobResults: new Map(),
      skipOutcomeSignal: true,
    });

    const result = await executeJob({
      ...defaultJobInput,
      jobId: 'job-claim-timeout',
      executionTimeoutMs: 250,
    });

    expect(result.status).toBe('failed');
    expect(finalStatusesFor('job-claim-timeout')).toEqual(['running']);
    expect(callsNamed('failJobExecutionAsTimedOutActivity')).toHaveLength(1);
  });

  test('surfaces a timeout activity failure', async () => {
    setCfg({
      dag: makeDag([dagJob('job-timeout-error', 'build')]),
      jobResults: new Map(),
      skipSignal: true,
      failJobExecutionAsTimedOutError: 'simulated DB outage',
    });

    await expect(
      executeJob({
        ...defaultJobInput,
        jobId: 'job-timeout-error',
        executionTimeoutMs: 250,
      }),
    ).rejects.toThrow();

    expect(finalStatusesFor('job-timeout-error')).toEqual([]);
  });

  test('no signal — workflow stays blocked indefinitely', async () => {
    setCfg({dag: makeDag([]), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('jobExecutionOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: 'job:job-stuck',
      args: [{...defaultJobInput, jobId: 'job-stuck'}],
    });

    await new Promise((r) => setTimeout(r, 2000));

    const description = await handle.describe();
    expect(description.status.name).toBe('RUNNING');

    // Clean up: signal it so it completes and does not leak.
    setCfg({dag: makeDag([]), jobResults: new Map()});
    await handle.signal('job-finished', {status: 'failed'});
    await handle.result();
  }, 15_000);
});

describe('prebuilt workflow bundle', () => {
  it('starts a worker from a prebuilt workflow bundle', async () => {
    const bundleDirectory = await mkdtemp(join(tmpdir(), 'shipfox-prebuilt-workflow-'));
    const codePath = join(bundleDirectory, 'workflows.bundle.js');
    let prebuiltWorker: Worker | undefined;
    let workerRunPromise: Promise<void> | undefined;

    try {
      const workflowBundle = await bundleProductionWorkflow(WORKFLOWS_PATH);
      await writeFile(codePath, workflowBundle.code);
      prebuiltWorker = await Worker.create({
        connection: testEnv.nativeConnection,
        taskQueue: PREBUILT_WORKFLOW_TASK_QUEUE,
        workflowBundle: {codePath},
        activities: {},
      });
      workerRunPromise = prebuiltWorker.run();

      await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));

      expect(prebuiltWorker.getStatus().runState).toBe('RUNNING');
    } finally {
      prebuiltWorker?.shutdown();
      await workerRunPromise;
      await rm(bundleDirectory, {recursive: true, force: true});
    }
  }, 10_000);
});
