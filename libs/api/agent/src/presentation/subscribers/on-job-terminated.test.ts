import type {WorkflowsJobTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {config} from '#config.js';
import {AGENT_SESSION_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';
import {onJobTerminated} from './on-job-terminated.js';

const startMock = vi.fn();

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({
    workflow: {
      start: startMock,
    },
  }),
}));

function buildPayload(jobId: string): WorkflowsJobTerminatedEventDto {
  return {
    jobId,
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    status: 'failed',
    statusReason: null,
  };
}

function alreadyStartedError(): Error {
  const error = new Error('Workflow execution already started');
  error.name = 'WorkflowExecutionAlreadyStartedError';
  return error;
}

describe('onJobTerminated', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
  });

  it('arms the release-abandoned-session-claims workflow keyed on the job id', async () => {
    const jobId = crypto.randomUUID();

    await onJobTerminated(buildPayload(jobId));

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith('releaseAbandonedSessionClaims', {
      taskQueue: AGENT_SESSION_LIFECYCLE_TASK_QUEUE,
      workflowId: `agent-session-release:${jobId}`,
      workflowExecutionTimeout: '1 hour',
      args: [{jobId, graceSeconds: config.AGENT_SESSION_CLOSE_GRACE_SECONDS}],
    });
  });

  it('swallows a redelivered event when the workflow is already started', async () => {
    startMock.mockRejectedValue(alreadyStartedError());

    await expect(onJobTerminated(buildPayload(crypto.randomUUID()))).resolves.toBeUndefined();
  });

  it('re-throws an unexpected start failure so the outbox retries delivery', async () => {
    startMock.mockRejectedValue(new Error('temporal unreachable'));

    await expect(onJobTerminated(buildPayload(crypto.randomUUID()))).rejects.toThrow(
      'temporal unreachable',
    );
  });
});
