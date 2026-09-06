import {randomUUID} from 'node:crypto';
import {
  callsNamed,
  dagJob,
  makeDag,
  resetCalls,
  setCfg,
  setJobStatusCalls,
  setRunAttemptStatusCalls,
  setupEnv,
  TASK_QUEUE,
  teardownEnv,
  testEnv,
} from './test-env.js';

beforeAll(async () => {
  await setupEnv();
}, 60_000);

afterAll(async () => {
  await teardownEnv();
}, 15_000);

let workflowRunId: string;
let workspaceId: string;

beforeEach(() => {
  resetCalls();
  workflowRunId = `run-${randomUUID()}`;
  workspaceId = `workspace-${randomUUID()}`;
});

async function executeRun(): Promise<void> {
  await testEnv.client.workflow.execute('runOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `workflow-run-attempt:${workflowRunId}-attempt-1`,
    args: [{workflowRunId, runAttemptId: `${workflowRunId}-attempt-1`, workspaceId}],
  });
}

async function waitForActivity(name: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (callsNamed(name).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

describe('runOrchestration', () => {
  test('all-pending linear DAG enqueues every job and succeeds', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r1'), jobResults: new Map()});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'succeeded']);
    const enqueueCalls = callsNamed('queueJobExecutionActivity');
    expect(enqueueCalls).toHaveLength(3);
    expect(enqueueCalls.map((call) => call.params)).toEqual([
      {jobId: 'j1', jobExecutionId: 'j1'},
      {jobId: 'j2', jobExecutionId: 'j2'},
      {jobId: 'j3', jobExecutionId: 'j3'},
    ]);
  });

  test('already-succeeded upstream jobs are not re-enqueued', async () => {
    const jobs = [
      dagJob('j1', 'build', [], {status: 'succeeded'}),
      dagJob('j2', 'test', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r1-carried'), jobResults: new Map([['j2', 'succeeded']])});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'succeeded']);
    const enqueueCalls = callsNamed('queueJobExecutionActivity');
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.params).toMatchObject({jobId: 'j2'});
  });

  test('already-succeeded upstream jobs can unblock a failed retry', async () => {
    const jobs = [
      dagJob('j1', 'build', [], {status: 'succeeded'}),
      dagJob('j2', 'test', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r1-carried-failed'), jobResults: new Map([['j2', 'failed']])});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'failed']);
    const enqueueCalls = callsNamed('queueJobExecutionActivity');
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.params).toMatchObject({jobId: 'j2'});
  });

  test('parallel roots both succeed', async () => {
    const jobs = [
      dagJob('j1', 'lint'),
      dagJob('j2', 'test'),
      dagJob('j3', 'deploy', ['lint', 'test']),
    ];
    setCfg({dag: makeDag(jobs, 'r2'), jobResults: new Map()});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'succeeded']);
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(3);
  });

  test('single job fails, dependents are skipped', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r3'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'failed']);

    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(1);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j2',
      status: 'skipped',
      statusReason: 'default_gate_rejected',
    });
    expect(jobStatuses).toContainEqual({
      id: 'j3',
      status: 'skipped',
      statusReason: 'default_gate_rejected',
    });
  });

  test('first job fails, all downstream skipped', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'a', ['build']),
      dagJob('j3', 'b', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r4'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'failed']);
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(1);

    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j2',
      status: 'skipped',
      statusReason: 'default_gate_rejected',
    });
    expect(jobStatuses).toContainEqual({
      id: 'j3',
      status: 'skipped',
      statusReason: 'default_gate_rejected',
    });
  });

  test('explicit-if failure handler runs after a failed dependency', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'notify', ['build'], {hasActivationCondition: true}),
    ];
    setCfg({dag: makeDag(jobs, 'r-job-if-failed'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    expect(callsNamed('evaluateJobActivationsActivity')).toEqual([
      {
        name: 'evaluateJobActivationsActivity',
        params: {
          runAttemptId: `${workflowRunId}-attempt-1`,
          jobs: [{jobId: 'j2', expectedVersion: 1}],
        },
      },
    ]);
    expect(callsNamed('queueJobExecutionActivity').map((call) => call.params)).toEqual([
      expect.objectContaining({jobId: 'j1'}),
      expect.objectContaining({jobId: 'j2'}),
    ]);
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running', 'failed']);
  });

  test('explicit-if job skips when activation evaluation rejects it', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'notify', ['build'], {hasActivationCondition: true}),
    ];
    setCfg({
      dag: makeDag(jobs, 'r-job-if-rejected'),
      jobResults: new Map(),
      activationDecisions: new Map([
        ['j2', {kind: 'terminal-job', jobId: 'j2', status: 'skipped', jobVersion: 7}],
      ]),
    });

    await executeRun();

    expect(callsNamed('queueJobExecutionActivity').map((call) => call.params)).toEqual([
      expect.objectContaining({jobId: 'j1'}),
    ]);
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual([
      'running',
      'succeeded',
    ]);
  });

  test('fan-in explicit-if job activates after every need is terminal', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'lint'),
      dagJob('j3', 'notify', ['build', 'lint'], {hasActivationCondition: true}),
    ];
    setCfg({dag: makeDag(jobs, 'r-job-if-fanin'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    expect(callsNamed('evaluateJobActivationsActivity')).toEqual([
      {
        name: 'evaluateJobActivationsActivity',
        params: {
          runAttemptId: `${workflowRunId}-attempt-1`,
          jobs: [{jobId: 'j3', expectedVersion: 1}],
        },
      },
    ]);
    const enqueuedJobs = callsNamed('queueJobExecutionActivity').map((call) => call.params);
    expect(enqueuedJobs).toHaveLength(3);
    expect(enqueuedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({jobId: 'j1'}),
        expect.objectContaining({jobId: 'j2'}),
        expect.objectContaining({jobId: 'j3'}),
      ]),
    );
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running', 'failed']);
  });

  test('all-skipped run completes succeeded', async () => {
    const jobs = [dagJob('j1', 'notify', [], {hasActivationCondition: true})];
    setCfg({
      dag: makeDag(jobs, 'r-all-skipped'),
      jobResults: new Map(),
      activationDecisions: new Map([
        ['j1', {kind: 'terminal-job', jobId: 'j1', status: 'skipped', jobVersion: 4}],
      ]),
    });

    await executeRun();

    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(0);
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual([
      'running',
      'succeeded',
    ]);
  });

  test('explicit-if listening job skips before listener registration', async () => {
    const jobs = [dagJob('j1', 'listen', [], {mode: 'listening', hasActivationCondition: true})];
    setCfg({
      dag: makeDag(jobs, 'r-listen-skipped'),
      jobResults: new Map(),
      activationDecisions: new Map([
        ['j1', {kind: 'terminal-job', jobId: 'j1', status: 'skipped', jobVersion: 4}],
      ]),
    });

    await executeRun();

    expect(callsNamed('activateJobListenerActivity')).toHaveLength(0);
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual([
      'running',
      'succeeded',
    ]);
  });

  test('version tracking flows through correctly', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({dag: makeDag(jobs, 'r5'), jobResults: new Map()});

    await executeRun();

    // The final attempt status update should use the version returned by the first update.
    const finalRunAttemptStatus = setRunAttemptStatusCalls().at(-1);
    expect(finalRunAttemptStatus?.params.version).toBeGreaterThan(0);
  });

  test('cancel signal stops scheduling without calling runners directly', async () => {
    const jobs = [dagJob('j1', 'build'), dagJob('j2', 'deploy', ['build'])];
    setCfg({dag: makeDag(jobs, 'r-cancel'), jobResults: new Map(), skipSignal: true});

    const handle = await testEnv.client.workflow.start('runOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: `run:${workflowRunId}`,
      args: [{workflowRunId, workspaceId}],
    });
    await waitForActivity('queueJobExecutionActivity');

    await handle.signal('run-cancel');
    await handle.result();

    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running']);
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(1);
  });

  test('starts listening jobs and cancels them with the run', async () => {
    const jobs = [dagJob('j1', 'listen', [], {mode: 'listening'})];
    setCfg({dag: makeDag(jobs, 'r-listen'), jobResults: new Map()});
    const runAttemptId = `${workflowRunId}-attempt-listen`;

    const handle = await testEnv.client.workflow.start('runOrchestration', {
      taskQueue: TASK_QUEUE,
      workflowId: `workflow-run-attempt:${runAttemptId}`,
      args: [{workflowRunId, runAttemptId, workspaceId}],
    });
    await waitForActivity('setRunAttemptStatus');

    await handle.signal('run-cancel');
    await handle.result();

    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running']);
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(0);
  });

  test('classifies oversized listener activation as an output-size failure', async () => {
    const jobs = [dagJob('j1', 'listen', [], {mode: 'listening'})];
    setCfg({
      dag: makeDag(jobs, 'r-listen-too-large'),
      jobResults: new Map(),
      listenerActivationError: 'filter snapshot is too large',
    });

    await executeRun();

    expect(setJobStatusCalls()).toContainEqual({
      name: 'setJobStatus',
      params: expect.objectContaining({
        jobId: 'j1',
        status: 'failed',
        statusReason: 'output_too_large',
      }),
    });
    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running', 'failed']);
  });

  test('aborts early when the initial running write reports an already-terminal run', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({
      dag: makeDag(jobs, 'r-terminal'),
      jobResults: new Map(),
      initialRunStatus: 'cancelled',
    });

    await executeRun();

    expect(setRunAttemptStatusCalls().map((c) => c.params.status)).toEqual(['running']);
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(0);
  });

  test('diamond DAG with partial failure', async () => {
    const jobs = [
      dagJob('j1', 'A'),
      dagJob('j2', 'B', ['A']),
      dagJob('j3', 'C', ['A']),
      dagJob('j4', 'D', ['B', 'C']),
    ];
    setCfg({dag: makeDag(jobs, 'r6'), jobResults: new Map([['j2', 'failed']])});

    await executeRun();

    const runAttemptStatuses = setRunAttemptStatusCalls().map((c) => c.params.status);
    expect(runAttemptStatuses).toEqual(['running', 'failed']);

    // A, B, C enqueued: D skipped because B failed
    expect(callsNamed('queueJobExecutionActivity')).toHaveLength(3);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
      statusReason: c.params.statusReason ?? null,
    }));
    expect(jobStatuses).toContainEqual({
      id: 'j4',
      status: 'skipped',
      statusReason: 'default_gate_rejected',
    });
  });

  test('child workflow crash propagates to parent', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({
      dag: makeDag(jobs, 'r7'),
      jobResults: new Map(),
      queueError: 'Runner service unavailable',
    });

    await expect(executeRun()).rejects.toThrow();
  });
});
