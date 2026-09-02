import {createHash} from 'node:crypto';
import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {MAX_WORKFLOW_FILE_BYTES} from '@shipfox/api-definitions-dto';
import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import type {IntegrationValidationContext} from './entities/integration-context.js';
import {
  type DefinitionSyncDiagnostic,
  type DefinitionSyncErrorCode,
  limitDefinitionSyncDiagnostics,
} from './entities/sync-state.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import type {WorkflowDefinitionPayload} from './entities/workflow-definition.js';
import {DefinitionParseError, DefinitionSyncPermanentError} from './errors.js';
import type {DefinitionsSourceControl} from './integrations.js';
import {needsIntegrationValidationContext} from './needs-integration-validation-context.js';
import {parseDefinitionWithDiagnostics, stripDefinitionDiagnostics} from './parse-definition.js';
import type {ValidationError} from './validate-definition.js';

export const DEFAULT_WORKFLOW_PATH = '.shipfox/workflows/';
export const MAX_WORKFLOW_FILES = 100;
export {MAX_WORKFLOW_FILE_BYTES};
export const FILE_FETCH_CONCURRENCY = 4;
export const UNRESOLVED_SYNC_REF = '__unresolved__';
const TRAILING_SENTENCE_PUNCTUATION_RE = /[.!?]$/;

export interface SyncSourceContext {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: DefinitionsSourceControl;
}

export interface ResolvedSyncSource {
  ref: string;
}

export async function resolveSyncSource(params: SyncSourceContext): Promise<ResolvedSyncSource> {
  const source = await params.sourceControl.resolveRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });
  return {ref: source.repository.defaultBranch};
}

export interface DiscoverWorkflowFilesParams extends SyncSourceContext {
  ref: string;
  workflowPath?: string | undefined;
}

export async function discoverWorkflowFiles(
  params: DiscoverWorkflowFilesParams,
): Promise<{paths: string[]}> {
  const workflowPath = params.workflowPath ?? DEFAULT_WORKFLOW_PATH;
  const page = await params.sourceControl.listFiles({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
    ref: params.ref,
    prefix: workflowPath,
    limit: MAX_WORKFLOW_FILES,
  });
  if (page.nextCursor) {
    throw new DefinitionSyncPermanentError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
    );
  }

  const paths = page.files
    .filter((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'))
    .map((file) => file.path);
  if (paths.length === 0) {
    throw new DefinitionSyncPermanentError(
      'no-workflow-files',
      `No workflow files were found under ${workflowPath}`,
    );
  }

  return {paths};
}

export interface ParsedWorkflow {
  path: string;
  name: string;
  definition: WorkflowDefinitionPayload;
  contentHash: string;
  diagnostics: ValidationDiagnostic[];
}

export interface FetchAndParseWorkflowsParams extends SyncSourceContext {
  ref: string;
  paths: string[];
  onProgress?: ((path: string) => void) | undefined;
  agentValidationCatalog: AgentValidationCatalogV2;
  loadIntegrationValidationContext?: (() => Promise<IntegrationValidationContext>) | undefined;
}

export async function fetchAndParseWorkflows(
  params: FetchAndParseWorkflowsParams,
): Promise<ParsedWorkflow[]> {
  const parsed = await boundedMap(
    params.paths,
    FILE_FETCH_CONCURRENCY,
    async (path) => {
      params.onProgress?.(path);

      const snapshot = await params.sourceControl.fetchFile({
        workspaceId: params.workspaceId,
        connectionId: params.sourceConnectionId,
        externalRepositoryId: params.sourceExternalRepositoryId,
        ref: params.ref,
        path,
      });

      if (Buffer.byteLength(snapshot.content, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
        throw new DefinitionSyncPermanentError(
          'content-too-large',
          `Workflow file is larger than ${MAX_WORKFLOW_FILE_BYTES} bytes: ${snapshot.path}`,
        );
      }

      return {
        ...parseWorkflowSnapshot({
          path: snapshot.path,
          content: snapshot.content,
          agentValidationCatalog: params.agentValidationCatalog,
        }),
        rawContent: snapshot.content,
      };
    },
    {stopOnError: true},
  );

  if (
    !params.loadIntegrationValidationContext ||
    !parsed.some((entry) => needsIntegrationValidationContext(entry.definition.document))
  ) {
    return parsed.map(({rawContent: _rawContent, ...entry}) => entry);
  }

  const integrationValidationContext = await params.loadIntegrationValidationContext();
  return parsed.map((entry) =>
    parseWorkflowSnapshot({
      path: entry.path,
      content: entry.rawContent,
      agentValidationCatalog: params.agentValidationCatalog,
      integrationValidationContext,
    }),
  );
}

function parseWorkflowSnapshot(params: {
  path: string;
  content: string;
  integrationValidationContext?: IntegrationValidationContext | undefined;
  agentValidationCatalog: AgentValidationCatalogV2;
}): ParsedWorkflow {
  try {
    const definition =
      params.integrationValidationContext === undefined
        ? parseDefinitionWithDiagnostics(params.content, {
            agentValidationCatalog: params.agentValidationCatalog,
          })
        : parseDefinitionWithDiagnostics(params.content, {
            agentValidationCatalog: params.agentValidationCatalog,
            integrationValidationContext: params.integrationValidationContext,
          });
    const contentHash = sha256Hex(params.content);
    return {
      path: params.path,
      name: definition.document.name,
      definition: stripDefinitionDiagnostics(definition),
      contentHash,
      diagnostics: definition.diagnostics,
    };
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      throw new DefinitionSyncPermanentError(
        'invalid-definition',
        `Invalid workflow definition at ${params.path}: ${error.message}`,
        validationErrorsFrom(error.details),
        params.path,
      );
    }
    throw error;
  }
}

export interface SyncFailureClassification {
  code: DefinitionSyncErrorCode;
  message: string;
  retryable: boolean;
  diagnostics?: DefinitionSyncDiagnostic[] | undefined;
}

export function classifySyncFailure(error: unknown): SyncFailureClassification {
  if (error instanceof DefinitionSyncPermanentError) {
    const diagnostics = definitionSyncDiagnosticsFor(error.details, error.filePath);
    return {
      code: error.code,
      message: error.message,
      retryable: false,
      ...(diagnostics.length === 0 ? {} : {diagnostics}),
    };
  }
  const methods = [
    integrationsInterModuleContract.methods.resolveSourceRepository,
    integrationsInterModuleContract.methods.listSourceFiles,
    integrationsInterModuleContract.methods.fetchSourceFile,
  ] as const;
  for (const method of methods) {
    if (!isInterModuleKnownError(method, error)) continue;
    if (
      error.code === 'connection-not-found' ||
      error.code === 'connection-inactive' ||
      error.code === 'connection-workspace-mismatch'
    ) {
      return {code: 'connection-unavailable', message: error.message, retryable: false};
    }
    if (error.code === 'provider-failure') {
      return {
        code: providerErrorCode(error.details.reason),
        message: error.message,
        retryable: isProviderReasonRetryable(error.details.reason),
      };
    }
  }
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function isProviderReasonRetryable(reason: string): boolean {
  return reason === 'rate-limited' || reason === 'timeout' || reason === 'provider-unavailable';
}

function providerErrorCode(reason: string): DefinitionSyncErrorCode {
  if (reason === 'repository-not-found') return 'provider-repository-not-found';
  if (reason === 'file-not-found') return 'provider-file-not-found';
  if (reason === 'access-denied') return 'provider-access-denied';
  if (reason === 'rate-limited') return 'provider-rate-limited';
  if (reason === 'timeout') return 'provider-timeout';
  if (reason === 'provider-unavailable') return 'provider-unavailable';
  if (reason === 'malformed-provider-response') return 'provider-malformed-response';
  if (reason === 'content-too-large') return 'content-too-large';
  if (reason === 'too-many-files') return 'too-many-files';
  return 'unknown';
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function validationErrorsFrom(details: unknown): ValidationError[] {
  if (!Array.isArray(details)) return [];

  return details.filter(isValidationError);
}

function isValidationError(value: unknown): value is ValidationError {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.message === 'string' &&
    (candidate.path === undefined || typeof candidate.path === 'string') &&
    (candidate.reason === undefined || typeof candidate.reason === 'string')
  );
}

function definitionSyncDiagnosticsFor(
  errors: readonly ValidationError[],
  filePath?: string | undefined,
): DefinitionSyncDiagnostic[] {
  return limitDefinitionSyncDiagnostics(
    errors.map((error) => ({
      code: 'invalid-definition',
      message:
        error.reason === undefined
          ? error.message
          : `${error.message.replace(TRAILING_SENTENCE_PUNCTUATION_RE, '')}: ${error.reason}`,
      severity: 'error' as const,
      ...(error.path === undefined || error.path.length === 0 ? {} : {path: error.path}),
      ...(filePath === undefined ? {} : {filePath}),
    })),
  );
}
