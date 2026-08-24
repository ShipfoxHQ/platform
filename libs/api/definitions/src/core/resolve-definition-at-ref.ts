import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {
  TriggerDto,
  WorkflowModelSnapshot,
  WorkflowSourceSnapshot,
} from '@shipfox/api-definitions-dto';
import {
  createWorkflowModelSnapshot,
  DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT,
  DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH,
  DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH,
} from '@shipfox/api-definitions-dto';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {boundedMap} from '@shipfox/node-module';
import {definitionTriggersFor} from '#db/definition-triggers.js';
import {findOrCreateWorkflowLineage} from '#db/definitions.js';
import {recordDefinitionRefResolution} from '#metrics/index.js';
import type {ValidationDiagnostic} from './entities/validation-diagnostic.js';
import {
  DefinitionAtRefError,
  type DefinitionAtRefErrorCode,
  DefinitionParseError,
} from './errors.js';
import {loadIntegrationValidationContext} from './integrations.js';
import {needsIntegrationValidationContext} from './needs-integration-validation-context.js';
import type {ParsedDefinition} from './parse-definition.js';
import {parseDefinitionWithDiagnostics} from './parse-definition.js';
import {
  DEFAULT_WORKFLOW_PATH,
  FILE_FETCH_CONCURRENCY,
  MAX_WORKFLOW_FILE_BYTES,
  MAX_WORKFLOW_FILES,
} from './sync-definitions.js';
import type {ValidationError} from './validate-definition.js';

export interface ResolveDefinitionAtRefParams {
  projectId: string;
  ref: string;
  configPath: string;
  expectedCommit?: string | undefined;
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  signal?: AbortSignal;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path?: string | undefined;
}

export interface ResolvedDefinitionAtRef {
  workflow: {id: string; configPath: string};
  commit: string;
  model: WorkflowModelSnapshot;
  sourceSnapshot: WorkflowSourceSnapshot;
  triggers: Record<string, TriggerDto>;
  warnings: ValidationWarning[];
}

export interface ListDefinitionsAtRefParams {
  projectId: string;
  ref: string;
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  project?: DefinitionAtRefProject;
  signal?: AbortSignal;
}

export interface DefinitionAtRefProject {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export interface DefinitionAtRefFile {
  configPath: string;
  name: string | null;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  triggers: Record<string, TriggerDto>;
}

export interface DefinitionsAtRefListing {
  commit: string;
  files: DefinitionAtRefFile[];
}

interface ResolvedProjectSource {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}

/**
 * Resolves a workflow definition file at a git ref without persisting it.
 * The ref is pinned to a commit, the file is fetched at that commit, and the
 * result is validated with the sync pipeline. Only the workflow lineage row is
 * created so the dev run can be numbered; no definition row and no outbox
 * event are written.
 */
export async function resolveDefinitionAtRef(
  params: ResolveDefinitionAtRefParams,
): Promise<ResolvedDefinitionAtRef> {
  try {
    return await resolveDefinitionAtRefUnsafe(params);
  } catch (error) {
    if (error instanceof DefinitionAtRefError) {
      recordDefinitionRefResolution(error.code);
    }
    throw error;
  }
}

async function resolveDefinitionAtRefUnsafe(
  params: ResolveDefinitionAtRefParams,
): Promise<ResolvedDefinitionAtRef> {
  throwIfAborted(params.signal);
  const source = await requireProjectSource(
    params.projects,
    params.projectId,
    undefined,
    params.signal,
  );
  const commit = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref: params.ref,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  if (params.expectedCommit !== undefined && commit !== params.expectedCommit) {
    throw new DefinitionAtRefError(
      'ref-moved',
      `Git ref ${params.ref} no longer resolves to the expected commit`,
      {ref: params.ref, expectedCommit: params.expectedCommit},
    );
  }

  const snapshot = await fetchFileAtCommit({
    integrations: params.integrations,
    source,
    commit,
    ref: params.ref,
    configPath: params.configPath,
    signal: params.signal,
  });
  assertFileSize(snapshot.content, snapshot.path);

  const parsed = await parseDefinitionAtRef({
    content: snapshot.content,
    agent: params.agent,
    integrations: params.integrations,
    source,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  const workflowId = await findOrCreateWorkflowLineage({
    projectId: params.projectId,
    configPath: params.configPath,
  });
  recordDefinitionRefResolution('resolved');

  return {
    workflow: {id: workflowId, configPath: params.configPath},
    commit,
    model: createWorkflowModelSnapshot(parsed.model),
    sourceSnapshot: {content: snapshot.content, format: 'yaml'},
    triggers: definitionTriggersFor(parsed.model),
    warnings: warningsFor(parsed.diagnostics),
  };
}

/**
 * Lists the workflow files at a git ref with their validation state. Applies
 * the sync limits (100 files, 1 MB per file). One invalid file does not fail
 * the listing; it is reported as invalid.
 */
export async function listDefinitionsAtRef(
  params: ListDefinitionsAtRefParams,
): Promise<DefinitionsAtRefListing> {
  try {
    return await listDefinitionsAtRefUnsafe(params);
  } catch (error) {
    if (error instanceof DefinitionAtRefError) {
      recordDefinitionRefResolution(error.code);
    }
    throw error;
  }
}

type ListingEntry =
  | {path: string; content: string; definition: ParsedDefinition}
  | {path: string; errors: ValidationError[]};

async function listDefinitionsAtRefUnsafe(
  params: ListDefinitionsAtRefParams,
): Promise<DefinitionsAtRefListing> {
  throwIfAborted(params.signal);
  const source = await requireProjectSource(
    params.projects,
    params.projectId,
    params.project,
    params.signal,
  );
  const commit = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref: params.ref,
    signal: params.signal,
  });
  throwIfAborted(params.signal);
  const paths = await listWorkflowFilesAtCommit({
    integrations: params.integrations,
    source,
    commit,
    signal: params.signal,
  });

  const fetched = await boundedMap(
    paths,
    FILE_FETCH_CONCURRENCY,
    (path) =>
      fetchListingFile({
        integrations: params.integrations,
        source,
        commit,
        ref: params.ref,
        path,
        signal: params.signal,
      }),
    {stopOnError: true, signal: params.signal},
  );
  throwIfAborted(params.signal);
  const agentValidationCatalog = await callWithSignal(
    params.agent.getValidationCatalog,
    {},
    params.signal,
  );
  throwIfAborted(params.signal);
  let entries = fetched.map((entry) => {
    throwIfAborted(params.signal);
    return parseListingEntry(entry, {agentValidationCatalog});
  });

  const needsIntegrationContext = entries.some(
    (entry) =>
      'definition' in entry && needsIntegrationValidationContext(entry.definition.document),
  );
  if (needsIntegrationContext) {
    const integrationValidationContext = await loadAtRefIntegrationValidationContext({
      integrations: params.integrations,
      source,
      signal: params.signal,
    });
    entries = entries.map((entry) =>
      'definition' in entry && needsIntegrationValidationContext(entry.definition.document)
        ? parseListingEntry(
            {path: entry.path, content: entry.content},
            {agentValidationCatalog, integrationValidationContext},
          )
        : entry,
    );
  }

  throwIfAborted(params.signal);
  recordDefinitionRefResolution('resolved');
  return {commit, files: entries.map((entry) => listingFileFor(entry))};
}

async function requireProjectSource(
  projects: ProjectsModuleClient,
  projectId: string,
  projectOverride: DefinitionAtRefProject | undefined,
  signal: AbortSignal | undefined,
): Promise<ResolvedProjectSource> {
  if (projectOverride !== undefined) return sourceForProject(projectOverride);

  const {project} = await callWithSignal(projects.getProjectById, {projectId}, signal);
  if (project === null) {
    throw new DefinitionAtRefError('project-not-found', `Project not found: ${projectId}`, {
      projectId,
    });
  }
  return sourceForProject(project);
}

function sourceForProject(project: DefinitionAtRefProject): ResolvedProjectSource {
  return {
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
  };
}

async function resolveRefToCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  ref: string;
  signal: AbortSignal | undefined;
}): Promise<string> {
  try {
    const resolved = await callWithSignal(
      params.integrations.resolveSourceRef,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.ref,
      },
      params.signal,
    );
    return resolved.commit;
  } catch (error) {
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      if (error.code === 'ref-not-found') {
        throw new DefinitionAtRefError('ref-not-found', `Git ref not found: ${params.ref}`, {
          ref: params.ref,
        });
      }
      if (error.code === 'ref-invalid') {
        throw new DefinitionAtRefError(
          'ref-invalid',
          `Git ref is not a resolvable branch or tag name: ${params.ref}`,
          {ref: params.ref},
        );
      }
      throw sourceUnavailable(error, 'The source repository is unavailable');
    }
    throw error;
  }
}

async function listWorkflowFilesAtCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  signal: AbortSignal | undefined;
}): Promise<string[]> {
  let page: Awaited<ReturnType<IntegrationsModuleClient['listSourceFiles']>>;
  try {
    page = await callWithSignal(
      params.integrations.listSourceFiles,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.commit,
        prefix: DEFAULT_WORKFLOW_PATH,
        limit: MAX_WORKFLOW_FILES,
      },
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    throw sourceUnavailable(error, 'The workflow files at the ref could not be listed');
  }
  if (page.nextCursor) {
    throw new DefinitionAtRefError(
      'too-many-files',
      `More than ${MAX_WORKFLOW_FILES} workflow files were found`,
      {fileCount: Math.max(page.files.length, MAX_WORKFLOW_FILES + 1)},
    );
  }
  return page.files
    .filter((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'))
    .map((file) => file.path);
}

async function fetchFileAtCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  ref: string;
  configPath: string;
  signal: AbortSignal | undefined;
}): Promise<{path: string; content: string}> {
  try {
    return await callWithSignal(
      params.integrations.fetchSourceFile,
      {
        workspaceId: params.source.workspaceId,
        connectionId: params.source.connectionId,
        externalRepositoryId: params.source.externalRepositoryId,
        ref: params.commit,
        path: params.configPath,
      },
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.fetchSourceFile, error)) {
      if (error.code === 'provider-failure' && error.details.reason === 'file-not-found') {
        throw new DefinitionAtRefError(
          'file-not-found',
          `Workflow file not found at ${params.ref}: ${params.configPath}`,
          {ref: params.ref, configPath: params.configPath},
        );
      }
      throw sourceUnavailable(error, 'The workflow file at the ref could not be fetched');
    }
    throw error;
  }
}

function assertFileSize(content: string, path: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_WORKFLOW_FILE_BYTES) {
    throw new DefinitionAtRefError(
      'content-too-large',
      `Workflow file is larger than ${MAX_WORKFLOW_FILE_BYTES} bytes: ${path}`,
      {configPath: path},
    );
  }
}

async function parseDefinitionAtRef(params: {
  content: string;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  signal: AbortSignal | undefined;
}): Promise<ParsedDefinition> {
  const agentValidationCatalog = await callWithSignal(
    params.agent.getValidationCatalog,
    {},
    params.signal,
  );
  throwIfAborted(params.signal);
  const firstPass = parseWorkflowDefinition(params.content, {agentValidationCatalog});
  if (!needsIntegrationValidationContext(firstPass.document)) return firstPass;

  const integrationValidationContext = await loadAtRefIntegrationValidationContext({
    integrations: params.integrations,
    source: params.source,
    signal: params.signal,
  });
  return parseWorkflowDefinition(params.content, {
    agentValidationCatalog,
    integrationValidationContext,
  });
}

function parseWorkflowDefinition(
  content: string,
  options: Parameters<typeof parseDefinitionWithDiagnostics>[1],
): ParsedDefinition {
  try {
    return parseDefinitionWithDiagnostics(content, options);
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      throw new DefinitionAtRefError(
        'invalid-definition',
        `Invalid workflow definition: ${error.message}`,
        {errors: boundedValidationErrors((error.details ?? []) as ValidationError[])},
      );
    }
    throw error;
  }
}

async function fetchListingFile(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  ref: string;
  path: string;
  signal: AbortSignal | undefined;
}): Promise<{path: string; content: string} | {path: string; errors: ValidationError[]}> {
  try {
    const snapshot = await fetchFileAtCommit({
      integrations: params.integrations,
      source: params.source,
      commit: params.commit,
      ref: params.ref,
      configPath: params.path,
      signal: params.signal,
    });
    assertFileSize(snapshot.content, snapshot.path);
    return {path: snapshot.path, content: snapshot.content};
  } catch (error) {
    if (error instanceof DefinitionAtRefError && isPerFileListingError(error.code)) {
      return {
        path: params.path,
        errors: boundedValidationErrors([{message: error.message}]),
      };
    }
    throw error;
  }
}

function parseListingEntry(
  entry: {path: string; content: string} | {path: string; errors: ValidationError[]},
  options: Parameters<typeof parseDefinitionWithDiagnostics>[1],
): ListingEntry {
  if ('errors' in entry) return entry;
  try {
    const definition = parseDefinitionWithDiagnostics(entry.content, options);
    return {path: entry.path, content: entry.content, definition};
  } catch (error) {
    if (error instanceof DefinitionParseError) {
      return {
        path: entry.path,
        errors: boundedValidationErrors((error.details ?? []) as ValidationError[]),
      };
    }
    throw error;
  }
}

function listingFileFor(entry: ListingEntry): DefinitionAtRefFile {
  if ('definition' in entry) {
    return {
      configPath: entry.path,
      name: entry.definition.document.name,
      valid: true,
      errors: [],
      warnings: listingWarningsFor(entry.definition.diagnostics),
      triggers: definitionTriggersFor(entry.definition.model),
    };
  }
  return {
    configPath: entry.path,
    name: null,
    valid: false,
    errors: entry.errors,
    warnings: [],
    triggers: {},
  };
}

function warningsFor(diagnostics: readonly ValidationDiagnostic[]): ValidationWarning[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === 'warning')
    .map((diagnostic) => ({
      code: diagnostic.code.slice(0, DEFINITION_SYNC_WARNING_CODE_MAX_LENGTH),
      message: diagnostic.message.slice(0, DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
      ...(diagnostic.path === undefined
        ? {}
        : {path: diagnostic.path.slice(0, DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}),
    }));
}

function listingWarningsFor(diagnostics: readonly ValidationDiagnostic[]): ValidationWarning[] {
  return warningsFor(diagnostics).slice(0, DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT);
}

function boundedValidationErrors(errors: readonly ValidationError[]): ValidationError[] {
  return errors.slice(0, DEFINITION_SYNC_DIAGNOSTICS_MAX_COUNT).map((error) => ({
    message: error.message.slice(0, DEFINITION_SYNC_WARNING_MESSAGE_MAX_LENGTH),
    ...(error.path === undefined
      ? {}
      : {path: error.path.slice(0, DEFINITION_SYNC_WARNING_PATH_MAX_LENGTH)}),
  }));
}

async function loadAtRefIntegrationValidationContext(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  signal: AbortSignal | undefined;
}) {
  try {
    return await loadIntegrationValidationContext(
      params.integrations,
      params.source.workspaceId,
      params.source.connectionId,
      params.signal,
    );
  } catch (error) {
    throwIfAborted(params.signal);
    throw sourceUnavailable(error, 'Integration validation context is unavailable');
  }
}

function isPerFileListingError(code: DefinitionAtRefErrorCode): boolean {
  return (
    code === 'file-not-found' ||
    code === 'content-too-large' ||
    code === 'invalid-definition' ||
    code === 'source-unavailable'
  );
}

function callWithSignal<Input, Output>(
  method: (input: Input, options?: {signal?: AbortSignal}) => Promise<Output>,
  input: Input,
  signal: AbortSignal | undefined,
): Promise<Output> {
  return signal === undefined ? method(input) : method(input, {signal});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted');
}

function sourceUnavailable(error: unknown, message: string): DefinitionAtRefError {
  return new DefinitionAtRefError(
    'source-unavailable',
    `${message}: ${error instanceof Error ? error.message : String(error)}`,
    sourceFailureDetails(error),
  );
}

function sourceFailureDetails(error: unknown): Record<string, unknown> {
  const methods = [
    integrationsInterModuleContract.methods.resolveSourceRef,
    integrationsInterModuleContract.methods.listSourceFiles,
    integrationsInterModuleContract.methods.fetchSourceFile,
    integrationsInterModuleContract.methods.getAgentToolsContext,
  ] as const;

  for (const method of methods) {
    if (!isInterModuleKnownError(method, error)) continue;
    if (
      error.code === 'connection-not-found' ||
      error.code === 'connection-inactive' ||
      error.code === 'connection-workspace-mismatch'
    ) {
      return {sourceCode: error.code};
    }
    if (error.code === 'provider-failure') {
      return {
        sourceCode: error.code,
        sourceReason: error.details.reason,
        ...(error.details.retryAfterSeconds === undefined
          ? {}
          : {retryAfterSeconds: error.details.retryAfterSeconds}),
      };
    }
  }

  return {};
}
