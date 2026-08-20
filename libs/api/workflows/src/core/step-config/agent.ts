import {
  AGENT_INTEGRATION_MCP_AUTH,
  AGENT_INTEGRATION_MCP_ENDPOINT,
  AGENT_INTEGRATION_MCP_SERVER_NAME,
  AGENT_INTEGRATION_MCP_TRANSPORT,
  type AgentIntegrationMcpServerConfigDto,
  type MaterializedAgentIntegrationConfigDto,
} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {ResolvedField, SiteResolvedField} from '@shipfox/expression';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import type {AgentThinking} from '@shipfox/workflow-document';
import type {AgentDefaultsResolver, ResolvedAgentDefaults} from '#core/agent-defaults.js';
import {
  type AgentToolMaterializationContext,
  type AgentToolMaterializationSnapshot,
  materializeAgentIntegrations,
} from '#core/agent-tools.js';
import type {PersistedEvaluationTraceEntry, StepConfigDispatchPlan} from '#core/entities/step.js';
import {AgentConfigUnresolvableError} from '#core/errors.js';
import {
  completeStepFieldWithTrace,
  literalField,
  resolveStepField,
  type WorkflowStepEvaluationTraceEntry,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type StepConfigMode = 'effective' | 'authored';
type FieldResolution =
  | {readonly kind: 'frozen'; readonly value: string}
  | {readonly kind: 'residual'; readonly field: ResolvedField};

interface AgentFieldResolutions {
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly prompt: FieldResolution;
  readonly model: FieldResolution | undefined;
  readonly provider: FieldResolution | undefined;
  readonly thinking: FieldResolution | undefined;
  readonly hasTemplates: boolean;
}

export interface ResolveAgentStepConfigParams {
  readonly jobKey: string;
  readonly step: WorkflowModelAgentStep;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly definitionId: string;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

export interface AgentStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

export async function resolveAgentStepConfig(
  params: ResolveAgentStepConfigParams,
): Promise<AgentStepConfig> {
  const fields = resolveAgentFields(params);
  const usesAuthoredMode = params.mode === 'authored';

  if (usesAuthoredMode) return authoredAgentStepConfig(params.step, fields);

  const hasDeferredAgentField =
    fields.model?.kind === 'residual' ||
    fields.provider?.kind === 'residual' ||
    fields.thinking?.kind === 'residual';
  if (hasDeferredAgentField) return deferredAgentStepConfig(params, fields);

  return await agentStepConfigWithDefaults(params.step, params, fields);
}

export async function completeAgentConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: StepConfigDispatchPlan;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): Promise<void> {
  const agent = params.plan.agent;
  if (agent === undefined) return;

  const prompt =
    agent.prompt === undefined
      ? readConfigString(params.config, 'prompt')
      : completeAgentField({
          field: 'agent.prompt',
          template: agent.prompt,
          params,
        });
  const model =
    agent.model === undefined
      ? readConfigString(params.config, 'model')
      : completeAgentField({
          field: 'agent.model',
          template: agent.model,
          params,
        });
  const provider =
    agent.provider === undefined
      ? readConfigString(params.config, 'provider')
      : completeAgentField({
          field: 'agent.provider',
          template: agent.provider,
          params,
        });

  const defaults = await completeAgentDefaults({
    harness: agent.harness ?? readConfigHarness(params.config),
    provider,
    model,
    thinking:
      agent.thinking === undefined
        ? readConfigThinking(params.config)
        : completeAgentField({field: 'agent.thinking', template: agent.thinking, params}),
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });
  params.config.harness = defaults.harness;
  params.config.provider = defaults.provider;
  params.config.model = defaults.model;
  params.config.thinking = defaults.thinking;
  params.config.prompt = prompt;
  if (agent.tools !== undefined) params.config.tools = [...agent.tools];
  const integrations = agent.integrations === undefined ? undefined : [...agent.integrations];
  if (integrations !== undefined) params.config.integrations = integrations;
  const mcpServers =
    agent.mcpServers ??
    (integrations === undefined ? undefined : agentIntegrationMcpServers(integrations));
  if (mcpServers !== undefined) params.config.mcpServers = [...mcpServers];
}

function completeAgentField(args: {
  readonly field: 'agent.prompt' | 'agent.model' | 'agent.provider' | 'agent.thinking';
  readonly template: ResolvedField;
  readonly params: {
    readonly context: WorkflowEvaluationContext;
    readonly definitionId: string;
    readonly trace: PersistedEvaluationTraceEntry[];
  };
}): string {
  const resolved = completeStepFieldWithTrace({
    field: args.field,
    errorField: args.field,
    template: args.template,
    context: args.params.context,
    definitionId: args.params.definitionId,
  });
  args.params.trace.push(...resolved.trace.map((entry) => ({...entry, field: args.field})));
  return resolved.value;
}

export async function completeAgentDefaults(params: {
  readonly harness: WorkflowModelAgentStep['harness'] | undefined;
  readonly provider: string | undefined;
  readonly model: string | undefined;
  readonly thinking: string | undefined;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<ResolvedAgentDefaults> {
  if (!params.resolveAgentDefaults) throw new Error('Agent defaults resolver is required');

  try {
    return await params.resolveAgentDefaults({
      harness: params.harness,
      provider: params.provider,
      model: params.model,
      thinking: params.thinking,
    });
  } catch (error) {
    if (
      isInterModuleKnownError(agentInterModuleContract.methods.resolveAgentConfig, error) &&
      error.code === 'agent-config-invalid'
    ) {
      const managedProviderId = error.details.managed_provider_id;
      throw new AgentConfigUnresolvableError(params.definitionId, {
        cause: error,
        ...(error.details.message === undefined ? {} : {message: error.details.message}),
        ...(managedProviderId === undefined
          ? {}
          : {code: 'workspace-providers-disabled', managedProviderId}),
      });
    }
    throw error;
  }
}

function resolveAgentFields(params: ResolveAgentStepConfigParams): AgentFieldResolutions {
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];
  const prompt = resolveAgentField({
    field: 'agent.prompt',
    value: params.step.prompt,
    template: params.step.templates?.prompt,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const model = resolveOptionalAgentField({
    field: 'agent.model',
    value: params.step.model,
    template: params.step.templates?.model,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const provider = resolveOptionalAgentField({
    field: 'agent.provider',
    value: params.step.provider,
    template: params.step.templates?.provider,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const thinking = resolveOptionalAgentField({
    field: 'agent.thinking',
    value: params.step.thinking,
    template: params.step.templates?.thinking,
    context: params.context,
    mode: params.mode,
    diagnostics,
    trace,
    definitionId: params.definitionId,
  });
  const hasTemplates =
    params.step.templates?.prompt !== undefined ||
    params.step.templates?.model !== undefined ||
    params.step.templates?.provider !== undefined ||
    params.step.templates?.thinking !== undefined;

  return {diagnostics, trace, prompt, model, provider, thinking, hasTemplates};
}

function authoredAgentStepConfig(
  step: WorkflowModelAgentStep,
  fields: AgentFieldResolutions,
): AgentStepConfig {
  return {
    config: {
      ...(step.provider === undefined ? {} : {provider: step.provider}),
      ...(step.model === undefined ? {} : {model: step.model}),
      ...(step.harness === undefined ? {} : {harness: step.harness}),
      ...(step.thinking === undefined ? {} : {thinking: step.thinking}),
      ...agentToolsConfig(step),
      ...authoredAgentIntegrationsConfig(step),
      prompt: step.prompt,
    },
    configPlan: null,
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

function deferredAgentStepConfig(
  params: ResolveAgentStepConfigParams,
  fields: AgentFieldResolutions,
): AgentStepConfig {
  const {step} = params;
  return {
    config: {},
    configPlan: {
      agent: {
        prompt: dispatchPlanField(fields.prompt),
        ...(fields.model === undefined ? {} : {model: dispatchPlanField(fields.model)}),
        ...(fields.provider === undefined ? {} : {provider: dispatchPlanField(fields.provider)}),
        ...(step.harness === undefined ? {} : {harness: step.harness}),
        ...(fields.thinking === undefined ? {} : {thinking: dispatchPlanField(fields.thinking)}),
        ...agentToolsConfig(step),
        ...materializedAgentIntegrationsConfig(params),
      },
    },
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

async function agentStepConfigWithDefaults(
  step: WorkflowModelAgentStep,
  params: ResolveAgentStepConfigParams,
  fields: AgentFieldResolutions,
): Promise<AgentStepConfig> {
  const providerValue = frozenFieldValue(fields.provider);
  const modelValue = frozenFieldValue(fields.model);
  const promptIsDeferred = fields.prompt.kind === 'residual';

  const resolved = await completeAgentDefaults({
    harness: step.harness,
    provider: providerValue,
    model: modelValue,
    thinking: frozenFieldValue(fields.thinking),
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
  });
  if (promptIsDeferred) {
    return {
      config: {
        provider: resolved.provider,
        model: resolved.model,
        harness: resolved.harness,
        thinking: resolved.thinking,
      },
      configPlan: {
        agent: {
          prompt: dispatchPlanField(fields.prompt),
          ...agentToolsConfig(step),
          ...materializedAgentIntegrationsConfig(params),
        },
      },
      diagnostics: fields.diagnostics,
      trace: fields.trace,
      hasTemplates: fields.hasTemplates,
    };
  }

  const promptValue = frozenFieldValue(fields.prompt) ?? step.prompt;
  return {
    config: {
      provider: resolved.provider,
      model: resolved.model,
      harness: resolved.harness,
      thinking: resolved.thinking,
      ...agentToolsConfig(step),
      ...materializedAgentIntegrationsConfig(params),
      prompt: promptValue,
    },
    configPlan: null,
    diagnostics: fields.diagnostics,
    trace: fields.trace,
    hasTemplates: fields.hasTemplates,
  };
}

function agentToolsConfig(
  step: WorkflowModelAgentStep,
): {readonly tools: readonly string[]} | Record<string, never> {
  return step.tools === undefined ? {} : {tools: [...step.tools]};
}

function authoredAgentIntegrationsConfig(
  step: WorkflowModelAgentStep,
):
  | {readonly integrations: NonNullable<WorkflowModelAgentStep['integrations']>}
  | Record<string, never> {
  return step.integrations === undefined ? {} : {integrations: step.integrations};
}

function materializedAgentIntegrationsConfig(params: ResolveAgentStepConfigParams):
  | {
      readonly integrations: readonly MaterializedAgentIntegrationConfigDto[];
      readonly mcpServers: readonly AgentIntegrationMcpServerConfigDto[];
    }
  | Record<string, never> {
  const integrations = materializeAgentIntegrations({
    jobKey: params.jobKey,
    stepId: params.step.id,
    integrations: params.step.integrations,
    context: params.agentToolContext,
    snapshot: params.agentToolSnapshot,
  });
  return integrations === undefined
    ? {}
    : {integrations, mcpServers: agentIntegrationMcpServers(integrations)};
}

function agentIntegrationMcpServers(
  integrations: readonly MaterializedAgentIntegrationConfigDto[],
): readonly AgentIntegrationMcpServerConfigDto[] {
  return [
    {
      name: AGENT_INTEGRATION_MCP_SERVER_NAME,
      transport: AGENT_INTEGRATION_MCP_TRANSPORT,
      endpoint: AGENT_INTEGRATION_MCP_ENDPOINT,
      auth: AGENT_INTEGRATION_MCP_AUTH,
      integrations: [...integrations],
    },
  ];
}

function dispatchPlanField(field: FieldResolution): ResolvedField {
  const isResidual = field.kind === 'residual';
  return isResidual ? field.field : literalField(field.value);
}

function frozenFieldValue(field: FieldResolution | undefined): string | undefined {
  const isFrozen = field?.kind === 'frozen';
  return isFrozen ? field.value : undefined;
}

function resolveAgentField(params: {
  readonly field: 'agent.prompt' | 'agent.model' | 'agent.provider' | 'agent.thinking';
  readonly value: string;
  readonly template: ResolvedField['segments'] | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly definitionId: string;
}): FieldResolution {
  const hasTemplate = params.template !== undefined;
  const usesAuthoredMode = params.mode === 'authored';
  if (!hasTemplate || usesAuthoredMode) {
    return {kind: 'frozen', value: params.value};
  }

  const resolved = resolveStepField({
    field: params.field,
    template: {segments: params.template},
    context: params.context,
    definitionId: params.definitionId,
    errorField: params.field,
  });
  params.diagnostics.push(
    ...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: params.field})),
  );
  params.trace.push(...resolved.trace.map((entry) => ({...entry, field: params.field})));
  return fieldResolution(resolved);
}

function resolveOptionalAgentField(params: {
  readonly field: 'agent.prompt' | 'agent.model' | 'agent.provider' | 'agent.thinking';
  readonly value: string | undefined;
  readonly template: ResolvedField['segments'] | undefined;
  readonly context: WorkflowEvaluationContext;
  readonly mode: StepConfigMode;
  readonly diagnostics: WorkflowStepTemplateDiagnostic[];
  readonly trace: WorkflowStepEvaluationTraceEntry[];
  readonly definitionId: string;
}): FieldResolution | undefined {
  const hasValue = params.value !== undefined;
  if (!hasValue) return undefined;
  return resolveAgentField({...params, value: params.value});
}

function fieldResolution(resolved: SiteResolvedField): FieldResolution {
  if (resolved.kind === 'residual') return {kind: 'residual', field: resolved.field};
  return {kind: 'frozen', value: resolved.value};
}

function readConfigString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key];
  return typeof value === 'string' ? value : undefined;
}

function readConfigThinking(config: Record<string, unknown>): AgentThinking | undefined {
  const value = config.thinking;
  return value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
    ? value
    : undefined;
}

function readConfigHarness(
  config: Record<string, unknown>,
): WorkflowModelAgentStep['harness'] | undefined {
  return config.harness === 'pi' || config.harness === 'claude' ? config.harness : undefined;
}
