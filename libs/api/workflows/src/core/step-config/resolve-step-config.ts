import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions-dto';
import {WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS} from '@shipfox/api-definitions-dto';
import {
  type AvailabilitySite,
  capTraceEntries,
  type EvaluationTraceLimitEntry,
  type WorkflowExpressionEvaluationContext,
} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from '#core/agent-tools.js';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveAgentStepConfig} from './agent.js';
import {
  freezeStepField,
  resolveStepField,
  type StepConfigField,
  type WorkflowStepEvaluationTraceEntry,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import {resolveRunStepConfig, type StepConfigMode} from './run.js';
import {resolveToolStepConfig} from './tool.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type WorkflowModelCheckoutStep = Extract<WorkflowModelStep, {kind: 'checkout'}>;
type WorkflowModelToolStep = Extract<WorkflowModelStep, {kind: 'tool'}>;

export type {StepConfigField, WorkflowStepTemplateDiagnostic};

export interface ResolvedStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly authoredConfig: Record<string, unknown> | null;
  readonly name?: string;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly (WorkflowStepEvaluationTraceEntry | EvaluationTraceLimitEntry)[];
}

export interface ResolveStepConfigParams {
  readonly jobKey: string;
  readonly step: WorkflowModelStep;
  readonly workflowEnv: WorkflowModel['env'];
  readonly workflowEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly jobEnv: WorkflowModelJob['env'];
  readonly jobEnvTemplates: WorkflowEnvTemplates | undefined;
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

type BuildStepConfigParams = ResolveStepConfigParams & {readonly mode: StepConfigMode};

interface BuiltStepConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: StepConfigDispatchPlan | null;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

interface WorkingDirectoryConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: Pick<StepConfigDispatchPlan, 'working_directory'> | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

interface CheckoutConfig {
  readonly config: Record<string, unknown>;
  readonly configPlan: Pick<StepConfigDispatchPlan, 'checkout'> | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
  readonly hasTemplates: boolean;
}

export async function resolveStepConfig(
  params: ResolveStepConfigParams,
): Promise<ResolvedStepConfig> {
  const context = evaluationContext(params);
  const effective = await buildStepConfig({...params, context, mode: 'effective'});
  const authoredConfig = effective.hasTemplates
    ? (await buildStepConfig({...params, context, mode: 'authored'})).config
    : null;
  const name = resolveStepName(params.step, context, params.definitionId);

  return {
    config: effective.config,
    configPlan: effective.configPlan,
    authoredConfig,
    ...(name.value === undefined || name.value === '' ? {} : {name: name.value}),
    diagnostics: [...effective.diagnostics, ...name.diagnostics],
    trace: capTraceEntries([...effective.trace, ...name.trace]),
  };
}

async function buildStepConfig(
  params: Omit<BuildStepConfigParams, 'context'> & {readonly context: WorkflowEvaluationContext},
): Promise<BuiltStepConfig> {
  const gate = gateConfigForStep(params.step);
  const outputs = outputsConfigForStep(params.step);
  const workingDirectory = resolveWorkingDirectoryConfig(params);
  const runStep = runStepOrNull(params.step);
  const isRunStep = runStep !== null;

  if (isRunStep) {
    const run = resolveRunStepConfig({...params, step: runStep});
    return {
      config: {...workingDirectory.config, ...run.config, ...gate, ...outputs},
      configPlan: mergeConfigPlans(run.configPlan, workingDirectory.configPlan),
      diagnostics: [...workingDirectory.diagnostics, ...run.diagnostics],
      trace: [...workingDirectory.trace, ...run.trace],
      hasTemplates: run.hasTemplates || workingDirectory.hasTemplates,
    };
  }

  const toolStep = toolStepOrNull(params.step);
  if (toolStep !== null) {
    const tool = resolveToolStepConfig({
      step: toolStep,
      jobKey: params.jobKey,
      context: params.context,
      definitionId: params.definitionId,
      ...(params.agentToolContext === undefined ? {} : {agentToolContext: params.agentToolContext}),
      ...(params.agentToolSnapshot === undefined
        ? {}
        : {agentToolSnapshot: params.agentToolSnapshot}),
      mode: params.mode,
    });
    return {
      config: {...tool.config, ...gate},
      configPlan: tool.configPlan ?? null,
      diagnostics: tool.diagnostics,
      trace: tool.trace,
      hasTemplates: tool.hasTemplates,
    };
  }

  const checkoutStep = checkoutStepOrNull(params.step);
  if (checkoutStep !== null) {
    const checkout = resolveCheckoutStepConfig({...params, step: checkoutStep});
    return {
      config: {
        ...checkout.config,
        ...gate,
        ...outputs,
      },
      configPlan: checkout.configPlan === undefined ? null : checkout.configPlan,
      diagnostics: checkout.diagnostics,
      trace: checkout.trace,
      hasTemplates: checkout.hasTemplates,
    };
  }

  const agentStep = agentStepOrNull(params.step);
  if (agentStep === null) throw new Error(`Unsupported workflow step kind: ${params.step.kind}`);

  const agent = await resolveAgentStepConfig({...params, step: agentStep});
  return {
    config: {...workingDirectory.config, ...agent.config, ...gate, ...outputs},
    configPlan: mergeConfigPlans(agent.configPlan, workingDirectory.configPlan),
    diagnostics: [...workingDirectory.diagnostics, ...agent.diagnostics],
    trace: [...workingDirectory.trace, ...agent.trace],
    hasTemplates: agent.hasTemplates || workingDirectory.hasTemplates,
  };
}

function resolveWorkingDirectoryConfig(
  params: Omit<BuildStepConfigParams, 'context'> & {readonly context: WorkflowEvaluationContext},
): WorkingDirectoryConfig {
  const value = params.step.workingDirectory;
  // Tool steps have no working tree, so they never carry a working-directory
  // template; the union narrows the remaining kinds to those that can.
  const template =
    params.step.kind === 'tool' ? undefined : params.step.templates?.workingDirectory;
  if (value === undefined) {
    return {
      config: {},
      configPlan: undefined,
      diagnostics: [],
      trace: [],
      hasTemplates: template !== undefined,
    };
  }

  if (template === undefined || params.mode === 'authored') {
    return {
      config: {working_directory: value},
      configPlan: undefined,
      diagnostics: [],
      trace: [],
      hasTemplates: template !== undefined,
    };
  }

  const resolved = resolveStepField({
    field: 'step.working_directory',
    template: {segments: template},
    context: params.context,
    definitionId: params.definitionId,
    errorField: 'step.working_directory',
  });
  const trace = resolved.trace.map((entry) => ({
    ...entry,
    field: 'step.working_directory' as const,
  }));
  const diagnostics = resolved.diagnostics.map((diagnostic) => ({
    ...diagnostic,
    field: 'step.working_directory' as const,
  }));
  if (resolved.kind === 'residual') {
    return {
      config: {},
      configPlan: {working_directory: resolved.field},
      diagnostics,
      trace,
      hasTemplates: true,
    };
  }

  return {
    config: {working_directory: resolved.value},
    configPlan: undefined,
    diagnostics,
    trace,
    hasTemplates: true,
  };
}

function mergeConfigPlans(
  primary: StepConfigDispatchPlan | null,
  secondary: Pick<StepConfigDispatchPlan, 'working_directory'> | undefined,
): StepConfigDispatchPlan | null {
  if (secondary === undefined) return primary;
  return {...(primary ?? {}), ...secondary};
}

function evaluationContext(params: {
  readonly context: WorkflowExpressionEvaluationContext;
  readonly site: AvailabilitySite;
}): WorkflowEvaluationContext {
  return {site: params.site, values: params.context};
}

function runStepOrNull(step: WorkflowModelStep): WorkflowModelRunStep | null {
  const isRunStep = step.kind === 'run';
  return isRunStep ? step : null;
}

function agentStepOrNull(step: WorkflowModelStep): WorkflowModelAgentStep | null {
  const isAgentStep = step.kind === 'agent';
  return isAgentStep ? step : null;
}

function checkoutStepOrNull(step: WorkflowModelStep): WorkflowModelCheckoutStep | null {
  const isCheckoutStep = step.kind === 'checkout';
  return isCheckoutStep ? step : null;
}

function toolStepOrNull(step: WorkflowModelStep): WorkflowModelToolStep | null {
  const isToolStep = step.kind === 'tool';
  return isToolStep ? step : null;
}

function resolveCheckoutStepConfig(
  params: Omit<BuildStepConfigParams, 'context' | 'step'> & {
    readonly context: WorkflowEvaluationContext;
    readonly step: WorkflowModelCheckoutStep;
  },
): CheckoutConfig {
  const checkout = params.step.checkout;
  const config: Record<string, unknown> = {
    fetch_depth: checkout.fetchDepth,
    permissions: checkout.permissions,
    persist_credentials: checkout.persistCredentials,
    ...(checkout.force === undefined ? {} : {force: checkout.force}),
  };
  const checkoutConfig: Record<string, unknown> = config;
  const checkoutPlan: NonNullable<StepConfigDispatchPlan['checkout']> = {};
  const diagnostics: WorkflowStepTemplateDiagnostic[] = [];
  const trace: WorkflowStepEvaluationTraceEntry[] = [];
  let hasTemplates = false;

  for (const [key, field] of WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS) {
    const template = checkout.templates?.[key];
    if (template !== undefined) hasTemplates = true;

    const value = checkout[key];
    if (value === undefined) continue;

    if (template === undefined || params.mode === 'authored') {
      checkoutConfig[key] = value;
      continue;
    }

    const resolved = resolveStepField({
      field,
      template: {segments: template},
      context: params.context,
      definitionId: params.definitionId,
      errorField: field,
    });
    trace.push(...resolved.trace.map((entry) => ({...entry, field})));
    diagnostics.push(...resolved.diagnostics.map((diagnostic) => ({...diagnostic, field})));

    if (resolved.kind === 'residual') {
      checkoutPlan[key] = resolved.field;
    } else {
      checkoutConfig[key] = resolved.value;
    }
  }

  return {
    config: {checkout: config},
    configPlan: Object.keys(checkoutPlan).length === 0 ? undefined : {checkout: checkoutPlan},
    diagnostics,
    trace,
    hasTemplates,
  };
}

function gateConfigForStep(step: WorkflowModelStep): Record<string, unknown> {
  const hasGate = step.gate !== undefined;
  return hasGate ? {gate: stepGateConfig(step.gate)} : {};
}

function outputsConfigForStep(step: WorkflowModelStep): Record<string, unknown> {
  const hasOutputs = step.outputs !== undefined;
  return hasOutputs ? {outputs: step.outputs} : {};
}

function resolveStepName(
  step: WorkflowModelStep,
  context: WorkflowEvaluationContext,
  definitionId: string,
): {
  readonly value: string | undefined;
  readonly diagnostics: readonly WorkflowStepTemplateDiagnostic[];
  readonly trace: readonly WorkflowStepEvaluationTraceEntry[];
} {
  const hasName = step.name !== undefined;
  if (!hasName) return {value: undefined, diagnostics: [], trace: []};

  const hasNameTemplate = step.templates?.name !== undefined;
  if (!hasNameTemplate) return {value: step.name, diagnostics: [], trace: []};

  const resolved = freezeStepField({
    field: 'step.name',
    template: {segments: step.templates.name},
    context,
    definitionId,
    errorField: 'step.name',
  });
  return {
    value: resolved.value,
    diagnostics: resolved.diagnostics.map((diagnostic) => ({...diagnostic, field: 'step.name'})),
    trace: resolved.trace.map((entry) => ({...entry, field: 'step.name'})),
  };
}

function stepGateConfig(gate: NonNullable<WorkflowModelStep['gate']>): Record<string, unknown> {
  const hasSuccess = gate.success !== undefined;
  const hasOnFailure = gate.onFailure !== undefined;
  const hasOnFailureFeedback = gate.onFailure?.feedback !== undefined;
  const hasOnFailureFeedbackTemplate = gate.onFailure?.feedbackTemplate !== undefined;

  return {
    ...(hasSuccess
      ? {
          success: {
            language: gate.success.language,
            check: gate.success.check,
            source: gate.success.source,
          },
        }
      : {}),
    ...(hasOnFailure
      ? {
          on_failure: {
            restart_from: gate.onFailure.restartFrom,
            ...(hasOnFailureFeedback ? {feedback: gate.onFailure.feedback} : {}),
            ...(hasOnFailureFeedbackTemplate
              ? {feedback_template: {segments: gate.onFailure.feedbackTemplate}}
              : {}),
          },
        }
      : {}),
  };
}
