import type {reportError as reportErrorType} from '@shipfox/node-error-monitoring';
import type {logger as loggerFactoryType} from '@shipfox/node-opentelemetry';
import {IntegrationProviderError} from '#core/errors.js';
import {
  catalogTool,
  connection,
  leaseContext,
  materializedIntegration,
  materializedTool,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {createIntegrationToolDispatcher} from './dispatch.js';
import type {AuthorizedIntegrationTool} from './resolve-authorized-tools.js';

const dispatchMocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  reportError: vi.fn(),
}));

const loggerFactory = (() => ({
  error: dispatchMocks.loggerError,
})) as unknown as typeof loggerFactoryType;
const reportError = dispatchMocks.reportError as unknown as typeof reportErrorType;

describe('createIntegrationToolDispatcher', () => {
  beforeEach(() => {
    dispatchMocks.loggerError.mockReset();
    dispatchMocks.reportError.mockReset();
  });

  it('preserves terminal provider errors without reporting them as outages', async () => {
    const providerError = new IntegrationProviderError(
      'provider-rejected',
      'commit_id is missing',
      undefined,
      422,
    );
    const dispatch = createDispatcher(providerError);

    const result = await dispatch({
      authorizedTool: authorizedTool(),
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      method: 'get',
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'commit_id is missing'}],
      structuredContent: {code: 'provider-rejected', status: 422},
    });
    expect(dispatchMocks.loggerError).not.toHaveBeenCalled();
    expect(dispatchMocks.reportError).not.toHaveBeenCalled();
  });

  it('reports provider outages while preserving their message and status', async () => {
    const providerError = new IntegrationProviderError(
      'provider-unavailable',
      'GitHub returned HTTP 503',
      undefined,
      503,
    );
    const dispatch = createDispatcher(providerError);

    const result = await dispatch({
      authorizedTool: authorizedTool(),
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      method: 'get',
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'GitHub returned HTTP 503'}],
      structuredContent: {code: 'provider-unavailable', status: 503},
    });
    expect(dispatchMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: providerError,
        provider: 'github',
        toolId: 'issue_read',
        method: 'get',
        errorCode: 'provider-unavailable',
        providerStatus: 503,
      }),
      'Integration agent tool provider was unavailable',
    );
    expect(dispatchMocks.loggerError.mock.calls[0]?.[0]).toMatchObject({
      jobId: 'job-1',
      jobExecutionId: 'execution-1',
      workflowRunId: 'run-1',
      workflowRunAttemptId: 'attempt-1',
      workspaceId: 'workspace-1',
      currentStepId: 'step-1',
      currentStepAttempt: 2,
      connectionId: 'connection-1',
    });
    expect(dispatchMocks.reportError).toHaveBeenCalledWith(providerError, {
      boundary: 'integration.agent-tool',
    });
  });

  it('classifies unrecognized failures as unknown instead of provider outages', async () => {
    const internalError = new Error('request timeout configuration is invalid');
    const dispatch = createDispatcher(internalError);

    const result = await dispatch({
      authorizedTool: authorizedTool(),
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      method: 'get',
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Integration tool call failed'}],
      structuredContent: {code: 'unknown'},
    });
    expect(dispatchMocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: internalError,
        provider: 'github',
        toolId: 'issue_read',
        method: 'get',
        errorCode: 'unknown',
      }),
      'Integration agent tool call failed',
    );
    expect(dispatchMocks.loggerError.mock.calls[0]?.[0]).not.toHaveProperty('providerStatus');
    expect(dispatchMocks.reportError).toHaveBeenCalledWith(internalError, {
      boundary: 'integration.agent-tool',
    });
  });

  it('returns a repository denial without opening the provider session', async () => {
    const onOpenSession = vi.fn();
    const entry = catalogTool({
      repositoryScope: () => ({
        kind: 'declared-targets',
        repositories: [{owner: 'shipfox', name: 'platform'}],
      }),
    });
    const resolveRepositoryAuthorization = vi.fn(async () => ({
      authorized: false as const,
      reason: 'repository_not_granted' as const,
    }));
    const dispatch = createIntegrationToolDispatcher(
      {
        registry: registryWithAgentTools([entry], {
          repositoryAuthorization: 'enforced',
          onOpenSession,
        }),
        lease: leaseContext({
          workspaceId: 'workspace-1',
          projectId: 'project-run',
        }),
        repositoryAuthorizer: {
          enabled: true,
          resolveRepositoryAuthorization,
        },
      },
      {logger: loggerFactory, reportError},
    );

    const result = await dispatch({
      authorizedTool: {...authorizedTool(), catalogEntry: entry},
      arguments: {method: 'get', owner: 'shipfox', repo: 'platform', issue_number: 1},
      method: 'get',
    });

    expect(result).toMatchObject({
      result: {
        isError: true,
        structuredContent: {code: 'repository-not-granted'},
      },
      authorization: {
        repositories: [{owner: 'shipfox', name: 'platform'}],
        classification: 'declared-targets',
        repositoryAccess: 'selected',
        decision: 'denied',
        denialReason: 'repository_not_granted',
        runProjectId: 'project-run',
      },
    });
    expect(resolveRepositoryAuthorization).toHaveBeenCalledTimes(1);
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});

function createDispatcher(callError: unknown) {
  return createIntegrationToolDispatcher(
    {
      registry: registryWithAgentTools([catalogTool()], {callError}),
      lease: leaseContext({
        jobId: 'job-1',
        jobExecutionId: 'execution-1',
        workflowRunId: 'run-1',
        workflowRunAttemptId: 'attempt-1',
        workspaceId: 'workspace-1',
        currentStepId: 'step-1',
        currentStepAttempt: 2,
      }),
    },
    {logger: loggerFactory, reportError},
  );
}

function authorizedTool(): AuthorizedIntegrationTool {
  const integration = materializedIntegration({connectionId: 'connection-1'});
  const tool = materializedTool();
  return {
    mcpName: 'github_main__issue_read',
    integration,
    tool,
    connection: connection({
      id: integration.connectionId,
      workspaceId: 'workspace-1',
      slug: integration.connectionSlug,
    }),
    description: 'Read issue metadata from GitHub.',
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  };
}
