import type {
  MaterializedAgentIntegrationConfigDto,
  MaterializedAgentIntegrationToolConfigDto,
} from '@shipfox/api-agent-dto';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {AgentIntegrationMaterializationError} from './errors.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelAgentStep = Extract<WorkflowModelJob['steps'][number], {kind: 'agent'}>;
type WorkflowModelStepIntegration = NonNullable<WorkflowModelAgentStep['integrations']>[number];
type IntegrationsAgentToolsContext = Awaited<
  ReturnType<IntegrationsModuleClient['getAgentToolsContext']>
>;
export type AgentToolCatalogEntry =
  IntegrationsAgentToolsContext['catalogs'][number]['tools'][number];
type AgentToolCatalogMethod = NonNullable<AgentToolCatalogEntry['methods']>[number];
type IntegrationProviderKind = IntegrationsAgentToolsContext['catalogs'][number]['provider'];
type AgentToolCatalogs = ReadonlyMap<IntegrationProviderKind, readonly AgentToolCatalogEntry[]>;
type WorkspaceConnectionSnapshot = ReadonlyMap<
  string,
  {
    id: string;
    provider: IntegrationProviderKind;
    capabilities: readonly ('source_control' | 'agent_tools')[];
  }
>;

export interface AgentToolMaterializationContext {
  readonly catalogs: AgentToolCatalogs;
  readonly workspaceConnectionSnapshot: WorkspaceConnectionSnapshot;
  readonly defaultConnection: {
    readonly id: string;
    readonly slug: string;
    readonly provider: IntegrationProviderKind;
  };
}

export interface AgentToolMaterializationSnapshot {
  readonly steps: readonly AgentToolMaterializationSnapshotStep[];
}

export interface AgentToolMaterializationSnapshotStep {
  readonly jobKey: string;
  readonly stepId: string;
  readonly integrations?: readonly MaterializedAgentIntegrationConfigDto[];
  readonly tool?: MaterializedToolStep;
}

export interface MaterializedToolStep {
  readonly connectionId: string;
  readonly connectionSlug: string;
  readonly provider: string;
  readonly id: string;
  readonly method?: string;
  readonly sensitivity: 'read' | 'write';
  readonly sensitive: boolean;
  readonly requiredScope: readonly unknown[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
}

interface SelectedToolState {
  readonly entry: AgentToolCatalogEntry;
  readonly methods: Map<string, AgentToolCatalogMethod>;
  selectedStandalone: boolean;
}

export async function loadAgentToolMaterializationContext(params: {
  readonly model: WorkflowModel | null;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly integrations?: IntegrationsModuleClient | undefined;
  readonly projects?: ProjectsModuleClient | undefined;
  readonly jobs?: readonly WorkflowModelJob[] | undefined;
}): Promise<AgentToolMaterializationContext | undefined> {
  if (!hasIntegrationToolReferences(params.model, params.jobs)) return undefined;

  if (params.projects === undefined) {
    throw new AgentIntegrationMaterializationError('Project access is not configured');
  }
  const {project} = await params.projects.getProjectById({projectId: params.projectId});
  if (project === null) {
    throw new AgentIntegrationMaterializationError(
      `Project ${params.projectId} was not found while materializing agent integrations`,
    );
  }

  if (params.integrations === undefined) {
    throw new AgentIntegrationMaterializationError('Agent tool materialization is not configured');
  }
  const context = await params.integrations.getAgentToolsContext({
    workspaceId: params.workspaceId,
    defaultConnectionId: project.sourceConnectionId,
  });
  const workspaceConnectionSnapshot = new Map(
    context.workspaceConnections.map(({slug, ...connection}) => [slug, connection]),
  );
  const defaultConnection = context.defaultConnection;
  if (defaultConnection === null) {
    throw new AgentIntegrationMaterializationError(
      `Source connection ${project.sourceConnectionId} was not found while materializing agent integrations`,
    );
  }

  return {
    catalogs: new Map(context.catalogs.map(({provider, tools}) => [provider, tools])),
    workspaceConnectionSnapshot,
    defaultConnection: {
      id: defaultConnection.id,
      slug: defaultConnection.slug,
      provider: defaultConnection.provider,
    },
  };
}

export function materializeAgentIntegrations(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly integrations: readonly WorkflowModelStepIntegration[] | undefined;
  readonly context: AgentToolMaterializationContext | undefined;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): MaterializedAgentIntegrationConfigDto[] | undefined {
  const snapshot = findSnapshotStep(params);
  if (snapshot !== undefined && snapshot.integrations !== undefined) {
    return snapshot.integrations.map(copyMaterializedIntegration);
  }
  if (params.integrations === undefined) return undefined;
  if (params.context === undefined) {
    throw new AgentIntegrationMaterializationError(
      'Agent integrations require materialization context',
    );
  }
  const {context} = params;

  return params.integrations.map((integration) =>
    materializeAgentIntegration({integration, context}),
  );
}

export function materializeToolStep(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly tool: {readonly id: string; readonly method?: string};
  readonly connection?: string | undefined;
  readonly context: AgentToolMaterializationContext | undefined;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): MaterializedToolStep {
  const snapshot = findSnapshotStep(params)?.tool;
  if (snapshot !== undefined) return {...snapshot, requiredScope: [...snapshot.requiredScope]};
  if (params.context === undefined) {
    throw new AgentIntegrationMaterializationError('Tool steps require materialization context');
  }
  const connection = resolveConnection({
    connectionSlug: params.connection,
    context: params.context,
    missingMessage: `Integration connection ${params.connection} was not found while materializing tool step`,
  });
  const catalog = params.context.catalogs.get(connection.provider);
  const entry = catalog?.find((candidate) => candidate.id === params.tool.id);
  if (entry === undefined)
    throw new AgentIntegrationMaterializationError(`Unknown integration tool: ${params.tool.id}`);
  const method = resolveToolMethod(entry, params.tool.method);
  return deepFreeze({
    connectionId: connection.id,
    connectionSlug: connection.slug,
    provider: connection.provider,
    id: entry.id,
    ...(method === undefined ? {} : {method: method.id}),
    sensitivity: method?.sensitivity ?? entry.sensitivity,
    sensitive: method?.sensitive ?? entry.sensitive,
    requiredScope: normalizeRequiredScope(method?.requiredScope ?? entry.requiredScope),
    inputSchema: cloneJson(entry.inputSchema),
    ...(entry.outputSchema === undefined ? {} : {outputSchema: cloneJson(entry.outputSchema)}),
  });
}

function resolveToolMethod(
  entry: AgentToolCatalogEntry,
  methodId: string | undefined,
): AgentToolCatalogMethod | undefined {
  if (methodId === undefined) return undefined;

  const method = entry.methods?.find((candidate) => candidate.id === methodId);
  if (method === undefined) {
    throw new AgentIntegrationMaterializationError(
      `Unknown integration tool: ${entry.id}.${methodId}`,
    );
  }
  return method;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createAgentToolMaterializationSnapshot(params: {
  readonly model: WorkflowModel;
  readonly context: AgentToolMaterializationContext | undefined;
}): AgentToolMaterializationSnapshot | null {
  if (params.context === undefined) return null;

  const steps: AgentToolMaterializationSnapshotStep[] = params.model.jobs.flatMap((job) =>
    job.steps.flatMap((step): AgentToolMaterializationSnapshotStep[] => {
      if (step.kind === 'tool') {
        const tool = materializeToolStep({
          jobKey: job.key,
          stepId: step.id,
          tool: step.tool,
          connection: step.connection,
          context: params.context,
          snapshot: undefined,
        });
        return [{jobKey: job.key, stepId: step.id, tool}];
      }
      if (step.kind !== 'agent' || step.integrations === undefined) return [];
      const integrations = materializeAgentIntegrations({
        jobKey: job.key,
        stepId: step.id,
        integrations: step.integrations,
        context: params.context,
      });
      if (integrations === undefined) return [];
      return [{jobKey: job.key, stepId: step.id, integrations}];
    }),
  );

  return steps.length === 0 ? null : {steps};
}

function findSnapshotStep(params: {
  readonly jobKey: string;
  readonly stepId: string;
  readonly snapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): AgentToolMaterializationSnapshotStep | undefined {
  return params.snapshot?.steps.find(
    (step) => step.jobKey === params.jobKey && step.stepId === params.stepId,
  );
}

function materializeAgentIntegration(params: {
  readonly integration: WorkflowModelStepIntegration;
  readonly context: AgentToolMaterializationContext;
}): MaterializedAgentIntegrationConfigDto {
  const connection = resolveConnection({
    connectionSlug: params.integration.connection,
    context: params.context,
    missingMessage: `Integration connection ${params.integration.connection} was not found while materializing agent integrations`,
  });
  const catalog = params.context.catalogs.get(connection.provider);
  if (catalog === undefined) {
    throw new AgentIntegrationMaterializationError(
      `Integration provider ${connection.provider} has no agent tool catalog`,
    );
  }

  const tools = selectTools({
    catalog,
    include: params.integration.include,
    exclude: params.integration.exclude ?? [],
  });
  const requiredScope = mergeRequiredScopes(tools.map((tool) => tool.requiredScope));

  return {
    connectionId: connection.id,
    connectionSlug: connection.slug,
    provider: connection.provider,
    requiredScope,
    tools,
  };
}

function copyMaterializedIntegration(
  integration: MaterializedAgentIntegrationConfigDto,
): MaterializedAgentIntegrationConfigDto {
  return {
    ...integration,
    requiredScope: [...integration.requiredScope],
    tools: integration.tools.map((tool) => ({
      ...tool,
      requiredScope: [...tool.requiredScope],
      ...(tool.methods === undefined
        ? {}
        : {
            methods: tool.methods.map((method) => ({
              ...method,
              requiredScope: [...method.requiredScope],
            })),
          }),
    })),
  };
}

function resolveConnection(params: {
  readonly connectionSlug: string | undefined;
  readonly context: AgentToolMaterializationContext;
  readonly missingMessage: string;
}): AgentToolMaterializationContext['defaultConnection'] {
  if (params.connectionSlug === undefined) return params.context.defaultConnection;

  const connection = params.context.workspaceConnectionSnapshot.get(params.connectionSlug);
  if (connection === undefined) {
    throw new AgentIntegrationMaterializationError(params.missingMessage);
  }
  return {
    id: connection.id,
    slug: params.connectionSlug,
    provider: connection.provider,
  };
}

function selectTools(params: {
  readonly catalog: readonly AgentToolCatalogEntry[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}): MaterializedAgentIntegrationToolConfigDto[] {
  const selected = new Map<string, SelectedToolState>();

  for (const token of params.include) {
    applySelection({catalog: params.catalog, selected, token, mode: 'include'});
  }
  for (const token of params.exclude) {
    applySelection({catalog: params.catalog, selected, token, mode: 'exclude'});
  }

  const tools = params.catalog.flatMap((entry) => {
    const state = selected.get(entry.id);
    if (state === undefined) return [];
    return [materializedTool(state)];
  });
  if (tools.length === 0) {
    throw new AgentIntegrationMaterializationError(
      'Agent integration selection resolved to no tools',
    );
  }
  return tools;
}

function applySelection(params: {
  readonly catalog: readonly AgentToolCatalogEntry[];
  readonly selected: Map<string, SelectedToolState>;
  readonly token: string;
  readonly mode: 'include' | 'exclude';
}): void {
  if (params.token === '*') {
    for (const entry of params.catalog) applyEntrySelection(params, entry);
    return;
  }

  const match = findCatalogSelection(params.catalog, params.token);
  if (match === undefined) {
    throw new AgentIntegrationMaterializationError(`Unknown integration tool: ${params.token}`);
  }
  applyEntrySelection(params, match.entry, match.method);
}

function applyEntrySelection(
  params: {
    readonly selected: Map<string, SelectedToolState>;
    readonly token: string;
    readonly mode: 'include' | 'exclude';
  },
  entry: AgentToolCatalogEntry,
  method?: AgentToolCatalogMethod | undefined,
): void {
  if (params.mode === 'exclude') {
    excludeEntrySelection(params.selected, entry, method);
    return;
  }

  const state =
    params.selected.get(entry.id) ??
    ({entry, methods: new Map(), selectedStandalone: false} satisfies SelectedToolState);
  if (entry.methods === undefined) {
    state.selectedStandalone = true;
  } else if (method === undefined) {
    for (const candidate of entry.methods) state.methods.set(candidate.id, candidate);
  } else {
    state.methods.set(method.id, method);
  }
  params.selected.set(entry.id, state);
}

function excludeEntrySelection(
  selected: Map<string, SelectedToolState>,
  entry: AgentToolCatalogEntry,
  method?: AgentToolCatalogMethod | undefined,
): void {
  if (method === undefined) {
    selected.delete(entry.id);
    return;
  }

  const state = selected.get(entry.id);
  if (state === undefined) return;
  state.methods.delete(method.id);
  if (!state.selectedStandalone && state.methods.size === 0) selected.delete(entry.id);
}

function findCatalogSelection(
  catalog: readonly AgentToolCatalogEntry[],
  token: string,
):
  | {readonly entry: AgentToolCatalogEntry; readonly method?: AgentToolCatalogMethod | undefined}
  | undefined {
  const entry = catalog.find((candidate) => candidate.id === token);
  if (entry !== undefined) return {entry};

  const wildcardSuffix = '.*';
  if (token.endsWith(wildcardSuffix)) {
    const family = token.slice(0, -wildcardSuffix.length);
    const familyEntry = catalog.find((candidate) => candidate.id === family);
    return familyEntry === undefined ? undefined : {entry: familyEntry};
  }

  const dotIndex = token.indexOf('.');
  if (dotIndex < 1) return undefined;
  const family = token.slice(0, dotIndex);
  const methodId = token.slice(dotIndex + 1);
  const familyEntry = catalog.find((candidate) => candidate.id === family);
  const method = familyEntry?.methods?.find((candidate) => candidate.id === methodId);
  if (familyEntry === undefined || method === undefined) return undefined;
  return {entry: familyEntry, method};
}

function materializedTool(state: SelectedToolState): MaterializedAgentIntegrationToolConfigDto {
  if (state.entry.methods === undefined) {
    return {
      id: state.entry.id,
      sensitivity: state.entry.sensitivity,
      sensitive: state.entry.sensitive,
      requiredScope: normalizeRequiredScope(state.entry.requiredScope),
      inputSchema: state.entry.inputSchema,
      ...(state.entry.outputSchema === undefined ? {} : {outputSchema: state.entry.outputSchema}),
    };
  }

  const methods = state.entry.methods
    .filter((method) => state.methods.has(method.id))
    .map((method) => ({
      id: method.id,
      token: `${state.entry.id}.${method.id}`,
      description: method.description,
      sensitivity: method.sensitivity,
      sensitive: method.sensitive,
      requiredScope: normalizeRequiredScope(method.requiredScope),
    }));

  return {
    id: state.entry.id,
    sensitivity: methods.some((method) => method.sensitivity === 'write') ? 'write' : 'read',
    sensitive: methods.some((method) => method.sensitive),
    requiredScope: mergeRequiredScopes(methods.map((method) => method.requiredScope)),
    inputSchema: state.entry.inputSchema,
    ...(state.entry.outputSchema === undefined ? {} : {outputSchema: state.entry.outputSchema}),
    methods,
  };
}

function mergeRequiredScopes(scopes: readonly unknown[]): unknown[] {
  const items = scopes.flatMap(normalizeRequiredScope);
  if (items.every(isPermissionScope)) {
    const byPermission = new Map<string, 'read' | 'write'>();
    for (const item of items) {
      const existing = byPermission.get(item.permission);
      if (existing === 'write') continue;
      byPermission.set(item.permission, item.access);
    }
    return [...byPermission.entries()].map(([permission, access]) => ({permission, access}));
  }

  const deduped = new Map<string, unknown>();
  for (const item of items) deduped.set(JSON.stringify(item), item);
  return [...deduped.values()];
}

function normalizeRequiredScope(scope: unknown): unknown[] {
  return Array.isArray(scope) ? [...scope] : [scope];
}

function isPermissionScope(
  value: unknown,
): value is {permission: string; access: 'read' | 'write'} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as {permission?: unknown; access?: unknown};
  return (
    typeof candidate.permission === 'string' &&
    (candidate.access === 'read' || candidate.access === 'write')
  );
}

/**
 * Model-level twin of `hasIntegrationToolReferences` in
 * `libs/api/definitions/src/core/has-integration-tool-references.ts`, which
 * runs the same criterion over the authored `WorkflowDocument` at sync time.
 * Keep both in sync.
 */
function hasIntegrationToolReferences(
  model: WorkflowModel | null,
  jobs: readonly WorkflowModelJob[] | undefined,
): boolean {
  if (model === null) return false;
  return (jobs ?? model.jobs).some((job) =>
    job.steps.some(
      (step) => step.kind === 'tool' || (step.kind === 'agent' && step.integrations !== undefined),
    ),
  );
}
