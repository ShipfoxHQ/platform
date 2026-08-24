import {
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
} from '#test/agent-tools-gateway-helpers.js';
import {
  createIntegrationToolCallRecorder,
  type IntegrationToolCallCaller,
  summarizeIntegrationToolArguments,
} from './tool-call-audit.js';

const agentCaller: IntegrationToolCallCaller = {
  caller: 'agent',
  lease: leaseContext({
    jobId: 'job-1',
    jobExecutionId: 'execution-1',
    workflowRunId: 'run-1',
    workflowRunAttemptId: 'attempt-1',
    workspaceId: 'workspace-1',
    currentStepId: 'step-1',
    currentStepAttempt: 2,
  }),
};

const toolStepCaller: IntegrationToolCallCaller = {
  caller: 'tool_step',
  workspaceId: 'workspace-1',
  runId: 'run-1',
  jobExecutionId: 'execution-1',
  stepId: 'step-1',
  stepAttempt: 2,
  callIndex: 3,
};

function auditTarget() {
  const integration = materializedIntegration({connectionId: 'connection-1'});
  const tool = materializedTool();
  return {
    integration,
    tool,
    connection: connection({
      id: 'connection-1',
      workspaceId: 'workspace-1',
      slug: integration.connectionSlug,
    }),
  };
}

describe('integration tool call audit', () => {
  it('records bounded metric labels and lease-tagged audit context for the agent caller', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const recorder = createIntegrationToolCallRecorder(agentCaller, {recordMetric, logInfo});

    recorder({
      authorizedTool: auditTarget(),
      arguments: {
        repo: 'platform',
        owner: 'shipfox',
        token: 'must-not-appear',
      },
      method: 'get',
      outcome: 'success',
      errorCode: 'none',
    });

    expect(recordMetric).toHaveBeenCalledWith({
      caller: 'agent',
      provider: 'github',
      tool: 'issue_read',
      method: 'get',
      outcome: 'success',
      error_code: 'none',
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'agent',
        jobId: 'job-1',
        jobExecutionId: 'execution-1',
        workflowRunId: 'run-1',
        workflowRunAttemptId: 'attempt-1',
        workspaceId: 'workspace-1',
        currentStepId: 'step-1',
        currentStepAttempt: 2,
        connectionId: 'connection-1',
        provider: 'github',
        toolId: 'issue_read',
        method: 'get',
        outcome: 'success',
        errorCode: 'none',
        argumentSummary: {
          keys: ['owner', 'repo', 'token'],
          serializedSizeBytes: expect.any(Number),
        },
      }),
      'integration tool call audited',
    );
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('must-not-appear');
  });

  it('records the tool-step caller identity on the metric and audit line', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const recorder = createIntegrationToolCallRecorder(toolStepCaller, {recordMetric, logInfo});

    recorder({
      authorizedTool: auditTarget(),
      arguments: {repo: 'private-repository', token: 'must-not-appear'},
      method: 'none',
      outcome: 'tool-error',
      errorCode: 'provider-rejected',
      providerStatus: 422,
    });

    expect(recordMetric).toHaveBeenCalledWith({
      caller: 'tool_step',
      provider: 'github',
      tool: 'issue_read',
      method: 'none',
      outcome: 'tool-error',
      error_code: 'provider-rejected',
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'tool_step',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        jobExecutionId: 'execution-1',
        stepId: 'step-1',
        stepAttempt: 2,
        callIndex: 3,
        errorCode: 'provider-rejected',
        providerStatus: 422,
      }),
      'integration tool call audited',
    );
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('private-repository');
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('must-not-appear');
  });

  it('falls back to unknown labels and omits the lease context for a leaseless agent caller', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const recorder = createIntegrationToolCallRecorder({caller: 'agent'}, {recordMetric, logInfo});

    recorder({
      arguments: {},
      method: 'none',
      outcome: 'invalid-request',
      errorCode: 'invalid-request',
    });

    expect(recordMetric).toHaveBeenCalledWith({
      caller: 'agent',
      provider: 'unknown',
      tool: 'unknown',
      method: 'none',
      outcome: 'invalid-request',
      error_code: 'invalid-request',
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: 'agent',
        provider: 'unknown',
        toolId: 'unknown',
      }),
      'integration tool call audited',
    );
    expect(logInfo.mock.calls[0]?.[0]).not.toHaveProperty('jobId');
  });

  it('summarizes arguments without values', () => {
    const summary = summarizeIntegrationToolArguments({z: 'secret', a: 1});

    expect(summary).toEqual({
      keys: ['a', 'z'],
      serializedSizeBytes: 20,
    });
  });
});
