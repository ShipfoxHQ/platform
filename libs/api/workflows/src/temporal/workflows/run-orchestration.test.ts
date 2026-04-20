import {randomUUID} from 'node:crypto';
import {
  callsNamed,
  dagJob,
  makeDag,
  resetCalls,
  setCfg,
  setJobStatusCalls,
  setRunStatusCalls,
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

let runId: string;
let workspaceId: string;

beforeEach(() => {
  resetCalls();
  runId = `run-${randomUUID()}`;
  workspaceId = `workspace-${randomUUID()}`;
});

async function executeRun(): Promise<void> {
  await testEnv.client.workflow.execute('runOrchestration', {
    taskQueue: TASK_QUEUE,
    workflowId: `run:${runId}`,
    args: [{runId, workspaceId}],
  });
}

describe('runOrchestration', () => {
  test('linear DAG, all succeed', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r1'), jobResults: new Map()});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'succeeded']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(3);
  });

  test('parallel roots both succeed', async () => {
    const jobs = [
      dagJob('j1', 'lint'),
      dagJob('j2', 'test'),
      dagJob('j3', 'deploy', ['lint', 'test']),
    ];
    setCfg({dag: makeDag(jobs, 'r2'), jobResults: new Map()});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'succeeded']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(3);
  });

  test('single job fails, dependents are cancelled', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'test', ['build']),
      dagJob('j3', 'deploy', ['test']),
    ];
    setCfg({dag: makeDag(jobs, 'r3'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);

    expect(callsNamed('enqueueJobForRunner')).toHaveLength(1);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
    }));
    expect(jobStatuses).toContainEqual({id: 'j2', status: 'cancelled'});
    expect(jobStatuses).toContainEqual({id: 'j3', status: 'cancelled'});
  });

  test('first job fails, all downstream cancelled', async () => {
    const jobs = [
      dagJob('j1', 'build'),
      dagJob('j2', 'a', ['build']),
      dagJob('j3', 'b', ['build']),
    ];
    setCfg({dag: makeDag(jobs, 'r4'), jobResults: new Map([['j1', 'failed']])});

    await executeRun();

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(1);
  });

  test('version tracking flows through correctly', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({dag: makeDag(jobs, 'r5'), jobResults: new Map()});

    await executeRun();

    // The final setRunStatus should use the version returned by the first setRunStatus
    const finalRunStatus = setRunStatusCalls().at(-1);
    expect(finalRunStatus?.params.version).toBeGreaterThan(0);
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

    const runStatuses = setRunStatusCalls().map((c) => c.params.status);
    expect(runStatuses).toEqual(['running', 'failed']);

    // A, B, C enqueued — D cancelled because B failed
    expect(callsNamed('enqueueJobForRunner')).toHaveLength(3);
    const jobStatuses = setJobStatusCalls().map((c) => ({
      id: c.params.jobId,
      status: c.params.status,
    }));
    expect(jobStatuses).toContainEqual({id: 'j4', status: 'cancelled'});
  });

  test('child workflow crash propagates to parent', async () => {
    const jobs = [dagJob('j1', 'build')];
    setCfg({
      dag: makeDag(jobs, 'r7'),
      jobResults: new Map(),
      enqueueError: 'Runner service unavailable',
    });

    await expect(executeRun()).rejects.toThrow();
  });
});
