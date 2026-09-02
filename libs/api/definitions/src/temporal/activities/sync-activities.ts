import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {markErrorReported} from '@shipfox/node-error-monitoring';
import {Context} from '@temporalio/activity';
import {ApplicationFailure} from '@temporalio/common';
import {
  type DefinitionSyncDiagnostic,
  type DefinitionSyncErrorCode,
  limitDefinitionSyncDiagnostics,
} from '#core/entities/sync-state.js';
import {
  classifySyncFailure,
  discoverWorkflowFiles,
  fetchAndParseWorkflows,
  resolveSyncSource,
  UNRESOLVED_SYNC_REF,
} from '#core/index.js';
import type {DefinitionsSourceControl} from '#core/integrations.js';
import {loadIntegrationValidationContext} from '#core/integrations.js';
import {applyVcsDefinitionsBatch, markDefinitionSyncState} from '#db/index.js';

export interface SyncWorkflowInput {
  projectId: string;
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceRef?: string | undefined;
  sourceCommitSha?: string | undefined;
}

export interface SyncRefScopedInput extends SyncWorkflowInput {
  sourceRef: string;
}

export interface FetchAndApplyActivityInput extends SyncRefScopedInput {
  paths: string[];
}

export interface MarkSyncFailedActivityInput extends Omit<SyncWorkflowInput, 'sourceRef'> {
  sourceRef: string | null;
  code: DefinitionSyncErrorCode;
  message: string;
  diagnostics?: readonly DefinitionSyncDiagnostic[] | undefined;
}

export interface PrepareSyncResult {
  sourceRef: string;
  sourceCommitSha?: string | undefined;
}

export interface DiscoverWorkflowsActivityResult {
  paths: string[];
}

export interface FetchAndApplyActivityResult {
  appliedCount: number;
  deletedCount: number;
  diagnostics: DefinitionSyncDiagnostic[];
}

export interface MarkSyncSucceededActivityInput extends SyncRefScopedInput {
  diagnostics?: readonly DefinitionSyncDiagnostic[] | undefined;
}

export interface DefinitionSyncActivityOptions {
  workflowPath: string;
}

export function createDefinitionSyncActivities(
  sourceControl: DefinitionsSourceControl,
  agent: AgentInterModuleClient,
  integrations?: IntegrationsModuleClient | undefined,
  options?: DefinitionSyncActivityOptions | undefined,
) {
  const fetchAndApplyDefinitionWorkflows = createFetchAndApplyActivity(
    sourceControl,
    agent,
    integrations,
  );
  const markDefinitionSyncSucceeded = createMarkSyncSucceededActivity();
  const markDefinitionSyncFailed = createMarkSyncFailedActivity();

  return {
    prepareDefinitionSync: createPrepareDefinitionSyncActivity(sourceControl),
    discoverDefinitionWorkflows: createDiscoverDefinitionWorkflowsActivity(
      sourceControl,
      options?.workflowPath,
    ),
    fetchAndApplyDefinitionWorkflows,
    // Versioned names keep old workers from silently dropping diagnostics.
    fetchAndApplyDefinitionWorkflowsV2: fetchAndApplyDefinitionWorkflows,
    markDefinitionSyncSucceeded,
    markDefinitionSyncSucceededV2: markDefinitionSyncSucceeded,
    markDefinitionSyncFailed,
    markDefinitionSyncFailedV2: markDefinitionSyncFailed,
  };
}

function createPrepareDefinitionSyncActivity(sourceControl: DefinitionsSourceControl) {
  return async function prepareDefinitionSync(
    input: SyncWorkflowInput,
  ): Promise<PrepareSyncResult> {
    return await runWithPermanentTranslation(async () => {
      const sourceRef = input.sourceRef ?? (await resolveSyncSource({...input, sourceControl})).ref;

      await markDefinitionSyncState({
        projectId: input.projectId,
        sourceConnectionId: input.sourceConnectionId,
        sourceExternalRepositoryId: input.sourceExternalRepositoryId,
        ref: sourceRef,
        status: 'syncing',
        lastErrorCode: null,
        lastErrorMessage: null,
        diagnostics: [],
        startedAt: new Date(),
        finishedAt: null,
      });

      return {sourceRef, sourceCommitSha: input.sourceCommitSha};
    });
  };
}

function createDiscoverDefinitionWorkflowsActivity(
  sourceControl: DefinitionsSourceControl,
  workflowPath?: string | undefined,
) {
  return async function discoverDefinitionWorkflows(
    input: SyncRefScopedInput,
  ): Promise<DiscoverWorkflowsActivityResult> {
    return await runWithPermanentTranslation(async () => {
      return await discoverWorkflowFiles({
        ...input,
        ref: input.sourceCommitSha ?? input.sourceRef,
        sourceControl,
        workflowPath,
      });
    });
  };
}

function createFetchAndApplyActivity(
  sourceControl: DefinitionsSourceControl,
  agent: AgentInterModuleClient,
  integrations?: IntegrationsModuleClient | undefined,
) {
  return async function fetchAndApplyDefinitionWorkflows(
    input: FetchAndApplyActivityInput,
  ): Promise<FetchAndApplyActivityResult> {
    return await runWithPermanentTranslation(async () => {
      const definitions = await fetchAndParseWorkflows({
        ...input,
        ref: input.sourceCommitSha ?? input.sourceRef,
        sourceControl,
        agentValidationCatalog: await agent.getValidationCatalogV2({
          workspaceId: input.workspaceId,
        }),
        onProgress: (path) => Context.current().heartbeat({path}),
        loadIntegrationValidationContext:
          integrations === undefined
            ? undefined
            : async () => {
                return await loadIntegrationValidationContext(
                  integrations,
                  input.workspaceId,
                  input.sourceConnectionId,
                );
              },
      });

      const result = await applyVcsDefinitionsBatch({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        ref: input.sourceRef,
        upserts: definitions.map((entry) => ({
          configPath: entry.path,
          name: entry.name,
          document: entry.definition.document,
          model: entry.definition.model,
          sourceSnapshot: entry.definition.sourceSnapshot,
          contentHash: entry.contentHash,
        })),
      });

      const diagnostics = limitDefinitionSyncDiagnostics(
        definitions.flatMap((entry) =>
          entry.diagnostics.map((diagnostic) => ({...diagnostic, filePath: entry.path})),
        ),
      );

      return {
        ...result,
        diagnostics,
      };
    });
  };
}

function createMarkSyncSucceededActivity() {
  return async function markDefinitionSyncSucceeded(
    input: MarkSyncSucceededActivityInput,
  ): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.sourceRef,
      status: 'succeeded',
      lastErrorCode: null,
      lastErrorMessage: null,
      diagnostics: input.diagnostics ?? [],
      finishedAt: new Date(),
    });
  };
}

function createMarkSyncFailedActivity() {
  return async function markDefinitionSyncFailed(
    input: MarkSyncFailedActivityInput,
  ): Promise<void> {
    await markDefinitionSyncState({
      projectId: input.projectId,
      sourceConnectionId: input.sourceConnectionId,
      sourceExternalRepositoryId: input.sourceExternalRepositoryId,
      ref: input.sourceRef ?? UNRESOLVED_SYNC_REF,
      status: 'failed',
      lastErrorCode: input.code,
      lastErrorMessage: input.message,
      diagnostics: input.diagnostics ?? [],
      finishedAt: new Date(),
    });
  };
}

async function runWithPermanentTranslation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApplicationFailure) {
      throw error;
    }
    const failure = classifySyncFailure(error);
    const details = failure.diagnostics === undefined ? [] : [failure.diagnostics];
    const translatedError = failure.retryable
      ? ApplicationFailure.retryable(failure.message, failure.code, ...details)
      : ApplicationFailure.nonRetryable(failure.message, failure.code, ...details);
    if (failure.code !== 'unknown') markErrorReported(translatedError);
    throw translatedError;
  }
}
