import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {
  TriggerDto,
  WorkflowModelSnapshot,
  WorkflowSourceSnapshot,
} from '@shipfox/api-definitions-dto';
import {createWorkflowModelSnapshot} from '@shipfox/api-definitions-dto';
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
import {DefinitionAtRefError, DefinitionParseError} from './errors.js';
import {hasAgentStepIntegrations} from './has-agent-step-integrations.js';
import {loadIntegrationValidationContext} from './integrations.js';
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
  const source = await requireProjectSource(params.projects, params.projectId);
  const commit = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref: params.ref,
  });
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
  });
  assertFileSize(snapshot.content, snapshot.path);

  const parsed = await parseDefinitionAtRef({
    content: snapshot.content,
    agent: params.agent,
    integrations: params.integrations,
    source,
  });
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
  const source = await requireProjectSource(params.projects, params.projectId);
  const commit = await resolveRefToCommit({
    integrations: params.integrations,
    source,
    ref: params.ref,
  });
  const paths = await listWorkflowFilesAtCommit({
    integrations: params.integrations,
    source,
    commit,
  });

  const fetched = await boundedMap(
    paths,
    FILE_FETCH_CONCURRENCY,
    (path) =>
      fetchListingFile({integrations: params.integrations, source, commit, ref: params.ref, path}),
    {stopOnError: true},
  );
  const agentValidationCatalog = await params.agent.getValidationCatalog({});
  let entries = fetched.map((entry) => parseListingEntry(entry, {agentValidationCatalog}));

  const needsIntegrationContext = entries.some(
    (entry) => 'definition' in entry && hasAgentStepIntegrations(entry.definition.document),
  );
  if (needsIntegrationContext) {
    const integrationValidationContext = await loadIntegrationValidationContext(
      params.integrations,
      source.workspaceId,
      source.connectionId,
    );
    entries = entries.map((entry) =>
      'definition' in entry && hasAgentStepIntegrations(entry.definition.document)
        ? parseListingEntry(
            {path: entry.path, content: entry.content},
            {agentValidationCatalog, integrationValidationContext},
          )
        : entry,
    );
  }

  recordDefinitionRefResolution('resolved');
  return {commit, files: entries.map((entry) => listingFileFor(entry))};
}

async function requireProjectSource(
  projects: ProjectsModuleClient,
  projectId: string,
): Promise<ResolvedProjectSource> {
  const {project} = await projects.getProjectById({projectId});
  if (project === null) {
    throw new DefinitionAtRefError('project-not-found', `Project not found: ${projectId}`, {
      projectId,
    });
  }
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
}): Promise<string> {
  try {
    const resolved = await params.integrations.resolveSourceRef({
      workspaceId: params.source.workspaceId,
      connectionId: params.source.connectionId,
      externalRepositoryId: params.source.externalRepositoryId,
      ref: params.ref,
    });
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
}): Promise<string[]> {
  try {
    const page = await params.integrations.listSourceFiles({
      workspaceId: params.source.workspaceId,
      connectionId: params.source.connectionId,
      externalRepositoryId: params.source.externalRepositoryId,
      ref: params.commit,
      prefix: DEFAULT_WORKFLOW_PATH,
      limit: MAX_WORKFLOW_FILES,
    });
    return page.files
      .filter((file) => file.path.endsWith('.yml') || file.path.endsWith('.yaml'))
      .slice(0, MAX_WORKFLOW_FILES)
      .map((file) => file.path);
  } catch (error) {
    throw sourceUnavailable(error, 'The workflow files at the ref could not be listed');
  }
}

async function fetchFileAtCommit(params: {
  integrations: IntegrationsModuleClient;
  source: ResolvedProjectSource;
  commit: string;
  ref: string;
  configPath: string;
}): Promise<{path: string; content: string}> {
  try {
    return await params.integrations.fetchSourceFile({
      workspaceId: params.source.workspaceId,
      connectionId: params.source.connectionId,
      externalRepositoryId: params.source.externalRepositoryId,
      ref: params.commit,
      path: params.configPath,
    });
  } catch (error) {
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
}): Promise<ParsedDefinition> {
  const agentValidationCatalog = await params.agent.getValidationCatalog({});
  const firstPass = parseWorkflowDefinition(params.content, {agentValidationCatalog});
  if (!hasAgentStepIntegrations(firstPass.document)) return firstPass;

  const integrationValidationContext = await loadIntegrationValidationContext(
    params.integrations,
    params.source.workspaceId,
    params.source.connectionId,
  );
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
        {errors: (error.details ?? []) as ValidationError[]},
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
}): Promise<{path: string; content: string} | {path: string; errors: ValidationError[]}> {
  try {
    const snapshot = await fetchFileAtCommit({
      integrations: params.integrations,
      source: params.source,
      commit: params.commit,
      ref: params.ref,
      configPath: params.path,
    });
    assertFileSize(snapshot.content, snapshot.path);
    return {path: snapshot.path, content: snapshot.content};
  } catch (error) {
    if (error instanceof DefinitionAtRefError) {
      return {path: params.path, errors: [{message: error.message}]};
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
      return {path: entry.path, errors: (error.details ?? []) as ValidationError[]};
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
      warnings: warningsFor(entry.definition.diagnostics),
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
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.path === undefined ? {} : {path: diagnostic.path}),
    }));
}

function sourceUnavailable(error: unknown, message: string): DefinitionAtRefError {
  return new DefinitionAtRefError(
    'source-unavailable',
    `${message}: ${error instanceof Error ? error.message : String(error)}`,
  );
}
