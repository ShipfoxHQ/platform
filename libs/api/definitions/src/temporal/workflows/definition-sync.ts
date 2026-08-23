import {ActivityFailure, ApplicationFailure, proxyActivities} from '@temporalio/workflow';
import {
  type DefinitionSyncErrorCode,
  isDefinitionSyncErrorCode,
} from '#core/entities/sync-state.js';
import type {createDefinitionSyncActivities} from '../activities/index.js';

export interface DefinitionSyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRef?: string | undefined;
  sourceCommitSha?: string | undefined;
}

export interface DefinitionSyncWorkflowResult {
  sourceRef: string;
  appliedCount: number;
  deletedCount: number;
}

const PROVIDER_RETRY = {
  initialInterval: '5 seconds',
  backoffCoefficient: 2,
  maximumInterval: '1 minute',
  maximumAttempts: 5,
} as const;

const DB_RETRY = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '15 seconds',
  maximumAttempts: 5,
} as const;

const {prepareDefinitionSync, discoverDefinitionWorkflows, fetchAndApplyDefinitionWorkflows} =
  proxyActivities<ReturnType<typeof createDefinitionSyncActivities>>({
    startToCloseTimeout: '5 minutes',
    heartbeatTimeout: '30 seconds',
    retry: PROVIDER_RETRY,
  });

const {markDefinitionSyncSucceeded, markDefinitionSyncFailed} = proxyActivities<
  ReturnType<typeof createDefinitionSyncActivities>
>({
  startToCloseTimeout: '30 seconds',
  retry: DB_RETRY,
});

export async function definitionSyncWorkflow(
  input: DefinitionSyncWorkflowInput,
): Promise<DefinitionSyncWorkflowResult> {
  let sourceRef: string | null = null;

  try {
    const prepared = await prepareDefinitionSync(input);
    sourceRef = prepared.sourceRef;

    const source = {
      ...input,
      sourceRef: prepared.sourceRef,
      sourceCommitSha: prepared.sourceCommitSha,
    };
    const {paths} = await discoverDefinitionWorkflows(source);
    const applied = await fetchAndApplyDefinitionWorkflows({...source, paths});

    await markDefinitionSyncSucceeded({...source, diagnostics: applied.diagnostics});

    return {
      sourceRef,
      appliedCount: applied.appliedCount,
      deletedCount: applied.deletedCount,
    };
  } catch (error) {
    const {code, message} = classifyWorkflowError(error);
    try {
      await markDefinitionSyncFailed({...input, sourceRef, code, message});
    } catch (markFailedError) {
      const failureOptions = {
        message: `Definition sync failed with ${code}: ${message}; additionally failed to persist failure state: ${formatWorkflowError(markFailedError)}`,
        type: 'definition-sync-failure-persistence-failed',
        nonRetryable: true,
        details: [
          {
            syncFailureCode: code,
            syncFailureMessage: message,
            failurePersistenceMessage: formatWorkflowError(markFailedError),
          },
        ],
      };
      throw ApplicationFailure.create(
        error instanceof Error ? {...failureOptions, cause: error} : failureOptions,
      );
    }
    throw error;
  }
}

export function classifyWorkflowError(error: unknown): {
  code: DefinitionSyncErrorCode;
  message: string;
} {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return classifyWorkflowError(error.cause);
  }
  if (error instanceof ApplicationFailure) {
    const code = isDefinitionSyncErrorCode(error.type) ? error.type : 'unknown';
    return {code, message: error.message ?? code};
  }
  return {code: 'unknown', message: error instanceof Error ? error.message : String(error)};
}

function formatWorkflowError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
