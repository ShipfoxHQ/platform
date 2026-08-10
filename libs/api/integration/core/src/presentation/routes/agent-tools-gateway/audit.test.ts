import {
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
} from '#test/agent-tools-gateway-helpers.js';
import {createIntegrationToolCallRecorder, summarizeIntegrationToolArguments} from './audit.js';

describe('integration tool call audit', () => {
  it('records bounded metric labels and structured audit context', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const lease = leaseContext({
      jobId: 'job-1',
      jobExecutionId: 'execution-1',
      workflowRunId: 'run-1',
      workflowRunAttemptId: 'attempt-1',
      workspaceId: 'workspace-1',
      currentStepId: 'step-1',
      currentStepAttempt: 2,
    });
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const tool = materializedTool();
    const recorder = createIntegrationToolCallRecorder(lease, {recordMetric, logInfo});

    recorder({
      authorizedTool: {
        mcpName: 'github_main__issue_read',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: 'Read issues',
        inputSchema: tool.inputSchema,
      },
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
      provider: 'github',
      tool: 'issue_read',
      method: 'get',
      outcome: 'success',
      error_code: 'none',
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it('records bounded provider error details without logging arguments', () => {
    const recordMetric = vi.fn();
    const logInfo = vi.fn();
    const lease = leaseContext({jobId: 'job-1', workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    const tool = materializedTool();
    const recorder = createIntegrationToolCallRecorder(lease, {recordMetric, logInfo});

    recorder({
      authorizedTool: {
        mcpName: 'github_main__issue_read',
        integration,
        tool,
        connection: connection({
          id: 'connection-1',
          workspaceId: 'workspace-1',
          slug: integration.connectionSlug,
        }),
        description: 'Read issues',
        inputSchema: tool.inputSchema,
      },
      arguments: {repo: 'private-repository', token: 'must-not-appear'},
      method: 'get',
      outcome: 'tool-error',
      errorCode: 'provider-rejected',
      providerStatus: 422,
    });

    expect(recordMetric).toHaveBeenCalledWith({
      provider: 'github',
      tool: 'issue_read',
      method: 'get',
      outcome: 'tool-error',
      error_code: 'provider-rejected',
    });
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        workspaceId: 'workspace-1',
        errorCode: 'provider-rejected',
        providerStatus: 422,
      }),
      'integration tool call audited',
    );
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('private-repository');
    expect(JSON.stringify(logInfo.mock.calls)).not.toContain('must-not-appear');
  });

  it('summarizes arguments without values', () => {
    const summary = summarizeIntegrationToolArguments({z: 'secret', a: 1});

    expect(summary).toEqual({
      keys: ['a', 'z'],
      serializedSizeBytes: 20,
    });
  });
});
