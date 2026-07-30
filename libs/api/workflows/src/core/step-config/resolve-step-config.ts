import type {WorkflowEnvTemplates, WorkflowModel} from '@shipfox/api-definitions-dto';
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
  type StepConfigField,
  type WorkflowStepEvaluationTraceEntry,
  type WorkflowStepTemplateDiagnostic,
} from './fields.js';
import {resolveRunStepConfig, type StepConfigMode} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
type WorkflowModelStep = WorkflowModelJob['steps'][number];
type WorkflowModelRunStep = Extract<WorkflowModelStep, {kind: 'run'}>;
type WorkflowModelAgentStep = Extract<WorkflowModelStep, {kind: 'agent'}>;
type WorkflowModelCheckoutStep = Extract<WorkflowModelStep, {kind: 'checkout'}>;

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
  const runStep = runStepOrNull(params.step);
  const isRunStep = runStep !== null;

  if (isRunStep) {
    const run = resolveRunStepConfig({...params, step: runStep});
    return {
      config: {...run.config, ...gate, ...outputs},
      configPlan: run.configPlan,
      diagnostics: run.diagnostics,
      trace: run.trace,
      hasTemplates: run.hasTemplates,
    };
  }

  const checkoutStep = checkoutStepOrNull(params.step);
  if (checkoutStep !== null) {
    return {
      config: {
        ...checkoutStepConfig(checkoutStep),
        ...gate,
        ...outputs,
      },
      configPlan: null,
      diagnostics: [],
      trace: [],
      hasTemplates: false,
    };
  }

  const agentStep = agentStepOrNull(params.step);
  if (agentStep === null) throw new Error(`Unsupported workflow step kind: ${params.step.kind}`);

  const agent = await resolveAgentStepConfig({...params, step: agentStep});
  return {
    config: {...agent.config, ...gate, ...outputs},
    configPlan: agent.configPlan,
    diagnostics: agent.diagnostics,
    trace: agent.trace,
    hasTemplates: agent.hasTemplates,
  };
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

function checkoutStepConfig(step: WorkflowModelCheckoutStep): Record<string, unknown> {
  const checkout = step.checkout;
  return {
    checkout: {
      ...(checkout.project === undefined ? {} : {project: checkout.project}),
      ...(checkout.connection === undefined ? {} : {connection: checkout.connection}),
      ...(checkout.repository === undefined ? {} : {repository: checkout.repository}),
      ...(checkout.ref === undefined ? {} : {ref: checkout.ref}),
      fetch_depth: checkout.fetchDepth,
      ...(checkout.path === undefined ? {} : {path: checkout.path}),
      permissions: checkout.permissions,
      persist_credentials: checkout.persistCredentials,
      ...(checkout.force === undefined ? {} : {force: checkout.force}),
    },
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
