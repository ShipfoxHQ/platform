import {getJobExecutionsByJobId, getJobsByWorkflowRunId} from '#db/index.js';
import {workflowRunFactory} from '#test/index.js';
import {onRunnerJobClaimed} from './on-runner-job-claimed.js';

const signalMock = vi.fn();
const getHandleMock = vi.fn(() => ({signal: signalMock}));

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {getHandle: getHandleMock}}),
}));

describe('onRunnerJobClaimed', () => {
  beforeEach(() => {
    getHandleMock.mockClear();
    signalMock.mockReset();
    signalMock.mockResolvedValue(undefined);
  });

  it('stamps started_at on the job execution from the claim event payload', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    expect(job).toBeDefined();
    if (!job) return;
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    expect(jobExecution).toBeDefined();
    if (!jobExecution) return;
    const claimedAt = new Date('2026-06-22T10:05:00.000Z');

    await onRunnerJobClaimed({
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      claimedAt: claimedAt.toISOString(),
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(claimedAt.getTime());
    expect(getHandleMock).toHaveBeenCalledWith(`job:${job.id}`);
    expect(signalMock).toHaveBeenCalledWith('job-claimed', {
      jobExecutionId: jobExecution.id,
      claimedAt: claimedAt.toISOString(),
    });
  });

  it('is idempotent: a redelivered event keeps the first started_at (coalesce)', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    expect(job).toBeDefined();
    if (!job) return;
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    expect(jobExecution).toBeDefined();
    if (!jobExecution) return;
    const first = new Date('2026-06-22T10:05:00.000Z');
    const second = new Date('2026-06-22T10:06:00.000Z');

    await onRunnerJobClaimed({
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      claimedAt: first.toISOString(),
    });
    await onRunnerJobClaimed({
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      claimedAt: second.toISOString(),
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(first.getTime());
  });

  it('discards a claim signal when the job workflow already terminated', async () => {
    const notFound = new Error('gone');
    notFound.name = 'WorkflowNotFoundError';
    signalMock.mockRejectedValueOnce(notFound);

    await expect(
      onRunnerJobClaimed({
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        claimedAt: '2026-06-22T10:05:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it('rethrows a transient Temporal signal failure for subscriber retry', async () => {
    const failure = new Error('temporal unavailable');
    signalMock.mockRejectedValueOnce(failure);

    await expect(
      onRunnerJobClaimed({
        workflowRunId: crypto.randomUUID(),
        workflowRunAttemptId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        jobExecutionId: crypto.randomUUID(),
        claimedAt: '2026-06-22T10:05:00.000Z',
      }),
    ).rejects.toBe(failure);
  });
});
