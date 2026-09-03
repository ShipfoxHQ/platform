import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowsWorkflowRunAttemptCreatedEventDto} from '@shipfox/api-workflows-dto';
import {
  createOnWorkflowRunAttemptCreated,
  onWorkflowRunAttemptCreated,
} from './on-workflow-run-attempt-created.js';

const startMock = vi.fn();
const carryOverMock = vi.fn();
const agent = {
  carryOverSessions: carryOverMock,
} as Pick<AgentInterModuleClient, 'carryOverSessions'>;

vi.mock('@shipfox/node-temporal', () => ({
  temporalClient: () => ({workflow: {start: startMock}}),
}));

function buildPayload(
  overrides: Partial<WorkflowsWorkflowRunAttemptCreatedEventDto> = {},
): WorkflowsWorkflowRunAttemptCreatedEventDto {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    attempt: 1,
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    definitionId: crypto.randomUUID(),
    ...overrides,
  };
}

describe('onWorkflowRunAttemptCreated', () => {
  beforeEach(() => {
    startMock.mockReset();
    startMock.mockResolvedValue({});
    carryOverMock.mockReset();
    carryOverMock.mockResolvedValue({sessions: []});
  });

  it('starts the run orchestration keyed on the attempt id', async () => {
    const payload = buildPayload();

    await onWorkflowRunAttemptCreated(payload);

    expect(startMock).toHaveBeenCalledWith('runOrchestration', {
      taskQueue: 'workflows-orchestrator',
      workflowId: `workflow-run-attempt:${payload.workflowRunAttemptId}`,
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      args: [
        {
          workflowRunId: payload.workflowRunId,
          runAttemptId: payload.workflowRunAttemptId,
          workspaceId: payload.workspaceId,
        },
      ],
    });
  });

  it('carries sessions before starting orchestration for a failed rerun', async () => {
    const payload = buildPayload({
      attempt: 2,
      carryOverFromWorkflowRunAttemptId: crypto.randomUUID(),
    });

    await createOnWorkflowRunAttemptCreated(agent)(payload);

    expect(carryOverMock).toHaveBeenCalledWith({
      fromWorkflowRunAttemptId: payload.carryOverFromWorkflowRunAttemptId,
      toWorkflowRunAttemptId: payload.workflowRunAttemptId,
    });
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(carryOverMock.mock.invocationCallOrder[0]).toBeLessThan(
      startMock.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not start orchestration when session carry-over fails', async () => {
    const payload = buildPayload({
      attempt: 2,
      carryOverFromWorkflowRunAttemptId: crypto.randomUUID(),
    });
    const failure = new Error('agent unavailable');
    carryOverMock.mockRejectedValueOnce(failure);

    await expect(createOnWorkflowRunAttemptCreated(agent)(payload)).rejects.toBe(failure);

    expect(startMock).not.toHaveBeenCalled();
  });

  it('swallows an already-started orchestration (outbox is at-least-once)', async () => {
    const alreadyStarted = new Error('already started');
    alreadyStarted.name = 'WorkflowExecutionAlreadyStartedError';
    startMock.mockRejectedValueOnce(alreadyStarted);

    const result = onWorkflowRunAttemptCreated(buildPayload());

    await expect(result).resolves.toBeUndefined();
    expect(startMock).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other start failure', async () => {
    const failure = new Error('temporal unavailable');
    startMock.mockRejectedValueOnce(failure);

    const result = onWorkflowRunAttemptCreated(buildPayload());

    await expect(result).rejects.toBe(failure);
  });
});
