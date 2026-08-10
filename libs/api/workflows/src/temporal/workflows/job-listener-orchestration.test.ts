import {randomUUID} from 'node:crypto';
import type {DrainListenerEventsResult} from '#db/job-listeners.js';
import {
  JOB_FINISHED_SIGNAL,
  LISTENER_EVENTS_AVAILABLE_SIGNAL,
  LISTENER_RESOLVE_SIGNAL,
} from '../constants.js';
import type {ListenerContinuationState} from './job-listener-orchestration.js';
import {
  callsNamed,
  listenerFiringOutcomeCalls,
  makeDag,
  resetCalls,
  resolveJobListenerCalls,
  setCfg,
  settleListenerCalls,
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

let jobId: string;

beforeEach(() => {
  resetCalls();
  jobId = `job-${randomUUID()}`;
});

interface ListenerInputOverrides {
  jobVersion?: number;
  executionTimeoutMs?: number | null;
  listeningTimeoutMs?: number | null;
  maxExecutions?: number | null;
  onResolve?: 'finish' | 'cancel' | null;
  batchDebounceMs?: number | null;
  batchMaxSize?: number | null;
  batchMaxWaitMs?: number | null;
  continuation?: ListenerContinuationState;
}

function listenerInput(overrides: ListenerInputOverrides = {}) {
  return {
    workspaceId: 'workspace-1',
    workflowRunId: 'run-1',
    projectId: 'project-1',
    runAttemptId: 'run-1-attempt-1',
    jobId,
    jobVersion: overrides.jobVersion ?? 1,
    requiredLabels: ['ubuntu22'],
    ...(overrides.executionTimeoutMs === undefined
      ? {}
      : {executionTimeoutMs: overrides.executionTimeoutMs}),
    ...(overrides.listeningTimeoutMs === undefined
      ? {}
      : {listeningTimeoutMs: overrides.listeningTimeoutMs}),
    ...(overrides.maxExecutions === undefined ? {} : {maxExecutions: overrides.maxExecutions}),
    ...(overrides.onResolve === undefined ? {} : {onResolve: overrides.onResolve}),
    ...(overrides.batchDebounceMs === undefined
      ? {}
      : {batchDebounceMs: overrides.batchDebounceMs}),
    ...(overrides.batchMaxSize === undefined ? {} : {batchMaxSize: overrides.batchMaxSize}),
    ...(overrides.batchMaxWaitMs === undefined ? {} : {batchMaxWaitMs: overrides.batchMaxWaitMs}),
    ...(overrides.continuation === undefined ? {} : {continuation: overrides.continuation}),
  };
}

function firingDrain(
  sequence: number,
  status: 'pending' | 'failed',
  requiredLabels: string[] = ['ubuntu22'],
): Extract<DrainListenerEventsResult, {kind: 'execution'}> {
  return {
    kind: 'execution',
    jobExecutionId: `exec-${sequence}`,
    executionVersion: 1,
    sequence,
    requiredLabels,
    status,
  };
}

function runListener(overrides?: ListenerInputOverrides) {
  return testEnv.client.workflow.execute('jobListenerOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job-listener:${jobId}`,
    args: [listenerInput(overrides)],
  });
}

function startListener(overrides?: ListenerInputOverrides) {
  return testEnv.client.workflow.start('jobListenerOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `job-listener:${jobId}`,
    args: [listenerInput(overrides)],
  });
}

async function waitForActivity(name: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (callsNamed(name).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

describe('jobListenerOrchestration', () => {
  describe('activation', () => {
    test.each([
      {jobStatus: 'succeeded', expected: 'succeeded'},
      {jobStatus: 'cancelled', expected: 'cancelled'},
      {jobStatus: 'failed', expected: 'failed'},
    ] as const)('already-terminal ($jobStatus) job returns $expected without draining', async ({
      jobStatus,
      expected,
    }) => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        listenerActivated: {status: 'terminal', jobStatus, jobVersion: 7, executionCount: 3},
      });

      const result = await runListener();

      expect(result).toEqual({status: expected, jobVersion: 7});
      expect(callsNamed('drainListenerEventsActivity')).toHaveLength(0);
      expect(resolveJobListenerCalls()).toHaveLength(0);
    });

    test('continued listeners skip activation and resume at the carried sequence', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(7, 'pending')],
        listenerResolved: {status: 'succeeded', jobVersion: 9},
      });

      const result = await runListener({
        maxExecutions: 7,
        continuation: {nextSequence: 7},
      });

      expect(callsNamed('activateJobListenerActivity')).toHaveLength(0);
      expect(callsNamed('drainListenerEventsActivity').map((c) => c.params)).toEqual([
        {jobId, expectedSequence: 7},
      ]);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['succeeded']);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['max_executions']);
      expect(result).toEqual({status: 'succeeded', jobVersion: 9});
    });
  });

  describe('resolution reasons', () => {
    test('resolves with max_executions after the last firing succeeds', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'pending')],
        listenerResolved: {status: 'succeeded', jobVersion: 9},
      });

      const result = await runListener({maxExecutions: 1});

      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['succeeded']);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['max_executions']);
      expect(result).toEqual({status: 'succeeded', jobVersion: 9});
    });

    test('resolves with until when the drain reports a resolve event', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [{kind: 'resolve-requested'}],
      });

      await runListener();

      expect(listenerFiringOutcomeCalls()).toHaveLength(0);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['until']);
    });

    test('resolves with until on a resolve signal without firing (zero-firing)', async () => {
      setCfg({dag: makeDag([]), jobResults: new Map(), drainResults: []});

      const handle = await startListener();
      await waitForActivity('drainListenerEventsActivity');
      await handle.signal(LISTENER_RESOLVE_SIGNAL);
      await handle.result();

      expect(listenerFiringOutcomeCalls()).toHaveLength(0);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['until']);
      expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(0);
    });

    test('resolves with timeout when the listening deadline elapses', async () => {
      setCfg({dag: makeDag([]), jobResults: new Map(), drainResults: []});

      await runListener({listeningTimeoutMs: 250});

      expect(listenerFiringOutcomeCalls()).toHaveLength(0);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['timeout']);
    });
  });

  describe('firing outcomes', () => {
    test('non-batch listeners keep the eager drain path', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({maxExecutions: 1});

      expect(callsNamed('peekListenerBufferActivity')).toHaveLength(0);
      expect(callsNamed('drainListenerEventsActivity')).toHaveLength(1);
    });

    test('records a succeeded firing when the child completes', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'pending', ['gpu', 'linux'])],
      });

      await runListener({maxExecutions: 1});

      expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(1);
      expect(callsNamed('enqueueJobExecutionForRunner')[0]?.params).toMatchObject({
        requiredLabels: ['gpu', 'linux'],
      });
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['succeeded']);
    });

    test('records a child-failed firing and still resolves the listener', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map([[jobId, 'failed']]),
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({maxExecutions: 1});

      // The child actually ran (enqueued), then returned failed.
      expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(1);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['failed']);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['max_executions']);
    });

    test('continues past a materialization-failed firing to a later success', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'failed'), firingDrain(2, 'pending')],
      });

      await runListener({maxExecutions: 2});

      // Sequence 1 failed at materialization (no child enqueued); sequence 2 ran and succeeded.
      expect(callsNamed('enqueueJobExecutionForRunner')).toHaveLength(1);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual([
        'failed',
        'succeeded',
      ]);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['max_executions']);
    });
  });

  describe('batch gate', () => {
    test('debounce waits for the newest buffered event to become quiet before firing', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        peekResults: [
          {fireCount: 3, resolvePending: false, oldestAgeMs: 25, newestAgeMs: 10},
          {fireCount: 3, resolvePending: false, oldestAgeMs: 75, newestAgeMs: 60},
        ],
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({batchDebounceMs: 50, maxExecutions: 1});

      expect(callsNamed('peekListenerBufferActivity')).toHaveLength(2);
      expect(callsNamed('drainListenerEventsActivity')).toHaveLength(1);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['succeeded']);
    });

    test('max_size fires immediately and caps the drain', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        peekResults: [{fireCount: 4, resolvePending: false, oldestAgeMs: 0, newestAgeMs: 0}],
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({batchDebounceMs: 1_000, batchMaxSize: 2, maxExecutions: 1});

      expect(callsNamed('peekListenerBufferActivity')).toHaveLength(1);
      expect(callsNamed('drainListenerEventsActivity').map((c) => c.params)).toEqual([
        {jobId, expectedSequence: 1, maxSize: 2},
      ]);
    });

    test('max_wait fires when the oldest buffered event reaches the cap', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        peekResults: [{fireCount: 2, resolvePending: false, oldestAgeMs: 500, newestAgeMs: 5}],
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({batchDebounceMs: 1_000, batchMaxWaitMs: 500, maxExecutions: 1});

      expect(callsNamed('drainListenerEventsActivity')).toHaveLength(1);
    });

    test('uses the DB peek to resolve without a resolve signal', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        peekResults: [{fireCount: 0, resolvePending: true, oldestAgeMs: 0, newestAgeMs: 0}],
        drainResults: [firingDrain(1, 'pending')],
      });

      await runListener({batchDebounceMs: 100});

      expect(callsNamed('drainListenerEventsActivity')).toHaveLength(0);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['until']);
    });

    test('honors a max_size-only config by waiting for enough buffered events', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        peekResults: [
          {fireCount: 1, resolvePending: false, oldestAgeMs: 0, newestAgeMs: 0},
          {fireCount: 2, resolvePending: false, oldestAgeMs: 0, newestAgeMs: 0},
        ],
        drainResults: [firingDrain(1, 'pending')],
      });

      const handle = await startListener({batchMaxSize: 2, maxExecutions: 1});
      await waitForActivity('peekListenerBufferActivity');
      await handle.signal(LISTENER_EVENTS_AVAILABLE_SIGNAL);
      await handle.result();

      expect(callsNamed('peekListenerBufferActivity')).toHaveLength(2);
      expect(callsNamed('drainListenerEventsActivity').map((c) => c.params)).toEqual([
        {jobId, expectedSequence: 1, maxSize: 2},
      ]);
    });
  });

  describe('resolution while a firing is in flight', () => {
    test('cancel mode cancels the in-flight firing and settles it cancelled', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'pending')],
        skipSignal: true,
      });

      const handle = await startListener({onResolve: 'cancel'});
      await waitForActivity('enqueueJobExecutionForRunner');
      await handle.signal(LISTENER_RESOLVE_SIGNAL);
      await handle.result();

      expect(settleListenerCalls().map((c) => c.params.status)).toEqual(['cancelled']);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['cancelled']);
      expect(callsNamed('cancelRunnerJobsActivity')).toHaveLength(0);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['until']);
    });

    test('finish mode lets the in-flight firing complete before resolving', async () => {
      setCfg({
        dag: makeDag([]),
        jobResults: new Map(),
        drainResults: [firingDrain(1, 'pending')],
        skipSignal: true,
      });

      const handle = await startListener({onResolve: 'finish'});
      await waitForActivity('enqueueJobExecutionForRunner');
      // Resolution arrives mid-firing; finish mode must wait for the child, not cancel it.
      await handle.signal(LISTENER_RESOLVE_SIGNAL);
      const child = testEnv.client.workflow.getHandle(`job:${jobId}`);
      await child.signal(JOB_FINISHED_SIGNAL, {status: 'succeeded', jobExecutionId: 'exec-1'});
      await handle.result();

      expect(settleListenerCalls()).toHaveLength(0);
      expect(callsNamed('cancelRunnerJobsActivity')).toHaveLength(0);
      expect(listenerFiringOutcomeCalls().map((c) => c.params.outcome)).toEqual(['succeeded']);
      expect(resolveJobListenerCalls().map((c) => c.params.reason)).toEqual(['until']);
    });
  });
});
