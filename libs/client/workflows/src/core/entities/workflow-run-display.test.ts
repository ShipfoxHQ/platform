import {
  workflowJob,
  workflowJobExecutionDto,
  workflowRunJobsFixture,
  workflowRunListItem,
} from '#test/fixtures/workflow-run.js';
import {
  workflowRunBlockingJob,
  workflowRunDetailDisplay,
  workflowRunListItemDisplay,
} from './workflow-run.js';

const ATTEMPT_STARTED_AT = '2026-05-07T01:00:00.000Z';
const WORK_STARTED_AT = '2026-05-07T01:02:00.000Z';
const FINISHED_AT = '2026-05-07T01:05:00.000Z';

describe('workflowRunDetailDisplay', () => {
  test('reads a running attempt whose jobs have not started as queued', () => {
    const display = workflowRunDetailDisplay(
      runDetail({jobs: [pendingJob()], startedAt: ATTEMPT_STARTED_AT}),
    );

    expect(display.status).toBe('queued');
    expect(display.duration).toEqual({kind: 'queue', state: 'live', fromIso: ATTEMPT_STARTED_AT});
  });

  test('measures run time from the first execution, not from the attempt', () => {
    const display = workflowRunDetailDisplay(
      runDetail({
        jobs: [startedJob(), pendingJob()],
        startedAt: ATTEMPT_STARTED_AT,
      }),
    );

    expect(display.status).toBe('running');
    expect(display.duration).toEqual({kind: 'run', state: 'live', fromIso: WORK_STARTED_AT});
  });

  test('does not treat skipped jobs as started work', () => {
    const display = workflowRunDetailDisplay(
      runDetail({
        jobs: [workflowJob({key: 'skipped', status: 'skipped'}), pendingJob()],
        startedAt: ATTEMPT_STARTED_AT,
      }),
    );

    expect(display.status).toBe('queued');
    expect(display.duration).toMatchObject({kind: 'queue'});
  });

  test('keeps the queue reading for a run cancelled before anything started', () => {
    const display = workflowRunDetailDisplay(
      runDetail({
        status: 'cancelled',
        jobs: [pendingJob()],
        startedAt: ATTEMPT_STARTED_AT,
        finishedAt: FINISHED_AT,
      }),
    );

    expect(display.status).toBe('cancelled');
    expect(display.duration).toMatchObject({kind: 'queue', state: 'fixed'});
  });

  test('does not claim a queue when the run carries no jobs to prove one', () => {
    const display = workflowRunDetailDisplay(runDetail({jobs: [], startedAt: ATTEMPT_STARTED_AT}));

    expect(display.status).toBe('running');
    expect(display.duration).toEqual({kind: 'run', state: 'live', fromIso: ATTEMPT_STARTED_AT});
  });

  test('has no duration before the attempt starts', () => {
    expect(workflowRunDetailDisplay(runDetail({jobs: [pendingJob()]})).duration).toBeNull();
  });
});

describe('workflowRunListItemDisplay', () => {
  test('reaches the detail page verdict from job status counts alone', () => {
    const run = workflowRunListItem({
      status: 'running',
      ...workflowRunJobsFixture(['pending', 'pending']),
      started_at: ATTEMPT_STARTED_AT,
    });

    const display = workflowRunListItemDisplay(run);

    expect(display.status).toBe('queued');
    expect(display.duration).toEqual({kind: 'queue', state: 'live', fromIso: ATTEMPT_STARTED_AT});
  });

  test('stays running once any job has left pending', () => {
    const run = workflowRunListItem({
      status: 'running',
      ...workflowRunJobsFixture(['succeeded', 'pending']),
      started_at: ATTEMPT_STARTED_AT,
    });

    const display = workflowRunListItemDisplay(run);

    expect(display.status).toBe('running');
    expect(display.duration).toMatchObject({kind: 'run'});
  });
});

describe('workflowRunBlockingJob', () => {
  test('ignores finished queued executions when finding the blocking job', () => {
    const historicalJob = workflowJob({
      key: 'historical',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          queued_at: '2026-05-07T00:59:00.000Z',
          finished_at: '2026-05-07T01:00:00.000Z',
        }),
      ],
    });
    const currentJob = workflowJob({
      key: 'current',
      job_executions: [workflowJobExecutionDto({queued_at: '2026-05-07T01:01:00.000Z'})],
    });

    expect(workflowRunBlockingJob([historicalJob, currentJob])?.key).toBe('current');
  });
});

function pendingJob() {
  return workflowJob({
    key: 'lint',
    job_executions: [workflowJobExecutionDto({queued_at: ATTEMPT_STARTED_AT})],
  });
}

function startedJob() {
  return workflowJob({
    key: 'build',
    status: 'running',
    job_executions: [
      workflowJobExecutionDto({
        status: 'running',
        queued_at: ATTEMPT_STARTED_AT,
        started_at: WORK_STARTED_AT,
      }),
    ],
  });
}

function runDetail({
  status = 'running',
  jobs,
  startedAt = null,
  finishedAt = null,
}: {
  status?: 'running' | 'cancelled';
  jobs: ReturnType<typeof workflowJob>[];
  startedAt?: string | null;
  finishedAt?: string | null;
}) {
  return {runAttempt: {status, startedAt, finishedAt}, jobs};
}
