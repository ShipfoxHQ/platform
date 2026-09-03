import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {getJobExecutionsByJobId, getJobsByWorkflowRunId} from '#db/index.js';
import {jobExecutions} from '#db/schema/job-executions.js';
import {workflowRunFactory} from '#test/index.js';
import {onRunnerJobClaimed} from './on-runner-job-claimed.js';

async function getJobExecutionRow(jobExecutionId: string) {
  const [row] = await db()
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.id, jobExecutionId))
    .limit(1);
  if (!row) throw new Error(`Expected job execution row ${jobExecutionId}`);
  return row;
}

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

  it('stamps started_at and runner identity on the job execution from the claim event payload', async () => {
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
      runnerLabels: ['linux', 'x64'],
      templateKey: 'standard',
      provisionerId: crypto.randomUUID(),
      provisionerScope: 'installation',
      providerKind: 'ec2',
      launchKind: 'demand',
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(claimedAt.getTime());
    const row = await getJobExecutionRow(jobExecution.id);
    expect(row).toMatchObject({
      runnerLabels: ['linux', 'x64'],
      templateKey: 'standard',
      provisionerScope: 'installation',
      providerKind: 'ec2',
      launchKind: 'demand',
    });
    expect(getHandleMock).toHaveBeenCalledWith(`job:${job.id}`);
    expect(signalMock).toHaveBeenCalledWith('job-claimed', {
      jobExecutionId: jobExecution.id,
      claimedAt: claimedAt.toISOString(),
    });
  });

  it('stamps null runner identity when the claim carries no known provisioner', async () => {
    const run = await workflowRunFactory.create();
    const job = (await getJobsByWorkflowRunId(run.id))[0];
    expect(job).toBeDefined();
    if (!job) return;
    const jobExecution = (await getJobExecutionsByJobId(job.id))[0];
    expect(jobExecution).toBeDefined();
    if (!jobExecution) return;

    await onRunnerJobClaimed({
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      claimedAt: '2026-06-22T10:05:00.000Z',
    });

    const row = await getJobExecutionRow(jobExecution.id);
    expect(row).toMatchObject({
      runnerLabels: null,
      templateKey: null,
      provisionerId: null,
      provisionerScope: null,
      providerKind: null,
      launchKind: null,
    });
  });

  it('is idempotent: a redelivered event keeps the first started_at and runner identity (coalesce)', async () => {
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
      runnerLabels: ['linux'],
      templateKey: 'standard',
      provisionerScope: 'installation',
      launchKind: 'demand',
    });
    await onRunnerJobClaimed({
      workflowRunId: run.id,
      workflowRunAttemptId: job.workflowRunAttemptId,
      jobId: job.id,
      jobExecutionId: jobExecution.id,
      claimedAt: second.toISOString(),
      runnerLabels: ['windows'],
      templateKey: 'other',
      provisionerScope: 'workspace',
      launchKind: 'warm',
    });

    const after = (await getJobExecutionsByJobId(job.id))[0];
    expect(after?.startedAt?.getTime()).toBe(first.getTime());
    const row = await getJobExecutionRow(jobExecution.id);
    expect(row).toMatchObject({
      runnerLabels: ['linux'],
      templateKey: 'standard',
      provisionerScope: 'installation',
      launchKind: 'demand',
    });
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
