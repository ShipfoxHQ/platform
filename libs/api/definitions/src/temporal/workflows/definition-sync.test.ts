const workflowMocks = vi.hoisted(() => ({
  prepareDefinitionSync: vi.fn(),
  discoverDefinitionWorkflows: vi.fn(),
  fetchAndApplyDefinitionWorkflows: vi.fn(),
  fetchAndApplyDefinitionWorkflowsV2: vi.fn(),
  markDefinitionSyncSucceeded: vi.fn(),
  markDefinitionSyncSucceededV2: vi.fn(),
  markDefinitionSyncFailed: vi.fn(),
  markDefinitionSyncFailedV2: vi.fn(),
  log: {warn: vi.fn()},
  patched: vi.fn(() => true),
}));

vi.mock('@temporalio/workflow', async () => {
  const actual =
    await vi.importActual<typeof import('@temporalio/workflow')>('@temporalio/workflow');
  return {
    ...actual,
    log: workflowMocks.log,
    patched: workflowMocks.patched,
    proxyActivities: vi.fn(() => ({
      prepareDefinitionSync: workflowMocks.prepareDefinitionSync,
      discoverDefinitionWorkflows: workflowMocks.discoverDefinitionWorkflows,
      fetchAndApplyDefinitionWorkflows: workflowMocks.fetchAndApplyDefinitionWorkflows,
      fetchAndApplyDefinitionWorkflowsV2: workflowMocks.fetchAndApplyDefinitionWorkflowsV2,
      markDefinitionSyncSucceeded: workflowMocks.markDefinitionSyncSucceeded,
      markDefinitionSyncSucceededV2: workflowMocks.markDefinitionSyncSucceededV2,
      markDefinitionSyncFailed: workflowMocks.markDefinitionSyncFailed,
      markDefinitionSyncFailedV2: workflowMocks.markDefinitionSyncFailedV2,
    })),
  };
});

import {ActivityFailure, ApplicationFailure, RetryState} from '@temporalio/common';
import {classifyWorkflowError, definitionSyncWorkflow} from './definition-sync.js';

describe('definitionSyncWorkflow error classification', () => {
  it('unwraps activity application failures before persisting sync failure metadata', () => {
    const cause = ApplicationFailure.nonRetryable(
      'Invalid workflow definition at .shipfox/workflows/bad.yml',
      'invalid-definition',
    );
    const error = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflows',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      cause,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition at .shipfox/workflows/bad.yml',
    });
  });

  it('classifies a bare ApplicationFailure using its type', () => {
    const error = ApplicationFailure.retryable('GitHub request timed out', 'provider-timeout');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'provider-timeout',
      message: 'GitHub request timed out',
    });
  });

  it('carries structured diagnostics from an ApplicationFailure', () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Step gate success must be a valid CEL boolean expression: No such key',
        path: 'jobs.build.steps.0.gate.success',
        severity: 'error' as const,
      },
    ];
    const error = ApplicationFailure.nonRetryable(
      'Invalid workflow definition',
      'invalid-definition',
      diagnostics,
    );

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics,
    });
  });

  it('falls back to unknown when ApplicationFailure.type is not a known sync error code', () => {
    const error = ApplicationFailure.nonRetryable('boom', 'something-unexpected');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'boom',
    });
  });

  it('classifies non-temporal errors as unknown and preserves the message', () => {
    const error = new Error('connection reset');

    const result = classifyWorkflowError(error);

    expect(result).toEqual({
      code: 'unknown',
      message: 'connection reset',
    });
  });
});

describe('definitionSyncWorkflow failure handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workflowMocks.patched.mockReturnValue(true);
    workflowMocks.prepareDefinitionSync.mockResolvedValue({sourceRef: 'main'});
    workflowMocks.discoverDefinitionWorkflows.mockResolvedValue({
      paths: ['.shipfox/workflows/invalid.yml'],
    });
    workflowMocks.markDefinitionSyncFailed.mockResolvedValue(undefined);
  });

  it('passes activity diagnostics to the failed-sync activity', async () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Invalid expression: No such key',
        path: 'jobs.build.success',
        filePath: '.shipfox/workflows/invalid.yml',
        severity: 'error' as const,
      },
    ];
    const activityError = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflowsV2',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      ApplicationFailure.nonRetryable(
        'Invalid workflow definition',
        'invalid-definition',
        diagnostics,
      ),
    );
    workflowMocks.fetchAndApplyDefinitionWorkflowsV2.mockRejectedValueOnce(activityError);

    const input = {
      projectId: 'project-id',
      workspaceId: 'workspace-id',
      sourceConnectionId: 'connection-id',
      sourceExternalRepositoryId: 'repository-id',
    };

    await expect(definitionSyncWorkflow(input)).rejects.toBe(activityError);
    expect(workflowMocks.markDefinitionSyncFailedV2).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
      diagnostics,
    });
  });

  it('keeps existing workflow histories on the legacy activity input shape', async () => {
    const diagnostics = [
      {
        code: 'invalid-definition',
        message: 'Invalid expression: No such key',
        path: 'jobs.build.success',
        severity: 'error' as const,
      },
    ];
    const activityError = new ActivityFailure(
      'Activity failed',
      'fetchAndApplyDefinitionWorkflows',
      'activity-id',
      RetryState.NON_RETRYABLE_FAILURE,
      'worker',
      ApplicationFailure.nonRetryable(
        'Invalid workflow definition',
        'invalid-definition',
        diagnostics,
      ),
    );
    workflowMocks.patched.mockReturnValue(false);
    workflowMocks.fetchAndApplyDefinitionWorkflows.mockRejectedValueOnce(activityError);

    const input = {
      projectId: 'project-id',
      workspaceId: 'workspace-id',
      sourceConnectionId: 'connection-id',
      sourceExternalRepositoryId: 'repository-id',
    };

    await expect(definitionSyncWorkflow(input)).rejects.toBe(activityError);
    expect(workflowMocks.markDefinitionSyncFailed).toHaveBeenCalledWith({
      ...input,
      sourceRef: 'main',
      code: 'invalid-definition',
      message: 'Invalid workflow definition',
    });
    expect(workflowMocks.log.warn).toHaveBeenCalledWith(
      'Definition sync diagnostics were not persisted for an existing workflow run',
      {code: 'invalid-definition'},
    );
  });
});
