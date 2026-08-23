import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {type WorkflowModelSnapshot, workflowModelFromSnapshot} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {createWorkflowRun} from '#db/workflow-runs.js';
import {createAgentDefaultsResolver} from './agent-defaults.js';
import type {
  TriggerPayload,
  WorkflowRun,
  WorkflowRunDevSource,
  WorkflowSourceSnapshot,
} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {modelHasAgentStep} from './step-config/materialize-workflow-model.js';

export interface RunWorkflowParams {
  workspaceId: string;
  projectId: string;
  definitionId: string;
  triggerPayload: TriggerPayload;
  triggerConnectionId?: string | undefined;
  inputs?: Record<string, unknown> | undefined;
  triggerIdempotencyKey?: string | undefined;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
}

export async function runWorkflow(
  definitions: DefinitionsInterModuleClient,
  params: RunWorkflowParams & {agent: AgentInterModuleClient},
  options: {secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>} = {},
): Promise<WorkflowRun> {
  const {definition} = await definitions.getDefinitionForWorkflowRun({
    definitionId: params.definitionId,
  });
  if (!definition) throw new DefinitionNotFoundError(params.definitionId);

  if (definition.projectId !== params.projectId) {
    throw new ProjectMismatchError(definition.projectId, params.projectId);
  }
  const model = workflowModelFromSnapshot(definition.model);
  const resolveAgentDefaults = createAgentDefaultsResolver(
    params.agent,
    modelHasAgentStep(model) ? params.workspaceId : null,
  );

  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: definition.workflowId,
    name: definition.name,
    model,
    triggerPayload: params.triggerPayload,
    triggerConnectionId: params.triggerConnectionId,
    inputs: params.inputs,
    sourceSnapshot: definition.sourceSnapshot,
    triggerIdempotencyKey: params.triggerIdempotencyKey,
    resolveAgentDefaults,
    secrets: options.secrets,
    integrations: params.integrations,
    projects: params.projects,
  });
}

export interface RunDevWorkflowParams {
  workspaceId: string;
  projectId: string;
  /** Workflow lineage id, becomes the run's definition_id. */
  workflowId: string;
  model: WorkflowModelSnapshot;
  sourceSnapshot: WorkflowSourceSnapshot;
  devSource: WorkflowRunDevSource;
  triggerPayload: TriggerPayload;
  triggerConnectionId?: string | undefined;
  inputs?: Record<string, unknown> | undefined;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
}

/**
 * Creates a dev run from an inline model and snapshot. Each call is a distinct
 * intent, so there is no idempotency key, as for manual fires. The lineage id
 * is used as the run's definition_id so dev runs share the workflow numbering
 * sequence before and after the file merges.
 */
export function runDevWorkflow(
  agent: AgentInterModuleClient,
  params: RunDevWorkflowParams,
  options: {secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>} = {},
): Promise<WorkflowRun> {
  const model = workflowModelFromSnapshot(params.model);
  const resolveAgentDefaults = createAgentDefaultsResolver(
    agent,
    modelHasAgentStep(model) ? params.workspaceId : null,
  );

  return createWorkflowRun({
    workspaceId: params.workspaceId,
    projectId: params.projectId,
    definitionId: params.workflowId,
    model,
    triggerPayload: params.triggerPayload,
    triggerConnectionId: params.triggerConnectionId,
    inputs: params.inputs,
    sourceSnapshot: params.sourceSnapshot,
    origin: 'dev',
    devSource: params.devSource,
    resolveAgentDefaults,
    secrets: options.secrets,
    integrations: params.integrations,
    projects: params.projects,
  });
}
